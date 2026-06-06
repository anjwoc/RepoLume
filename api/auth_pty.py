import asyncio
import os
import pty
import re
import time
import logging
from typing import Optional, Tuple, Dict

logger = logging.getLogger(__name__)

class AgyAuthSession:
    def __init__(self):
        self.pid: Optional[int] = None
        self.fd: Optional[int] = None
        self.auth_url: Optional[str] = None
        self.is_active: bool = False

    def clear(self):
        if self.pid is not None:
            try:
                os.kill(self.pid, 9)
            except OSError:
                pass
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
        self.pid = None
        self.fd = None
        self.auth_url = None
        self.is_active = False

global_auth_session = AgyAuthSession()

async def check_auth_status() -> bool:
    """Check if agy is already authenticated by running a dummy prompt."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "agy", "--dangerously-skip-permissions", "--print", "ping",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # We just need to read a little bit to see if it's asking for auth
        try:
            stdout_bytes = await asyncio.wait_for(proc.stdout.read(1024), timeout=3.0)
            output = stdout_bytes.decode(errors='replace')
            if "Authentication required" in output:
                proc.kill()
                return False
        except asyncio.TimeoutError:
            proc.kill()
            # If it timed out without saying authentication required, it might be actually processing the prompt!
            return True
            
        proc.kill()
        return True
    except Exception as e:
        logger.error(f"Error checking auth status: {e}")
        return False

async def start_auth_session() -> Dict[str, str]:
    """Starts agy in a PTY and captures the Google OAuth URL."""
    global global_auth_session
    global_auth_session.clear()

    pid, fd = pty.fork()
    if pid == 0:
        # Child process
        os.execvp("agy", ["agy", "--dangerously-skip-permissions", "--print", "ping"])
    else:
        # Parent process
        global_auth_session.pid = pid
        global_auth_session.fd = fd
        global_auth_session.is_active = True

        output = b""
        start_time = time.time()
        url = None
        
        # Read from PTY until we find the URL and the prompt
        while time.time() - start_time < 10:
            try:
                # Use asyncio to read non-blocking if possible, but os.read on PTY is fine with small timeout
                # We'll just use a short sleep loop
                await asyncio.sleep(0.1)
                
                # Check if data available
                import select
                r, _, _ = select.select([fd], [], [], 0)
                if r:
                    chunk = os.read(fd, 1024)
                    output += chunk
                    out_str = output.decode(errors='replace')
                    
                    # Extract URL
                    match = re.search(r'(https://accounts\.google\.com/o/oauth2/auth[^\s]+)', out_str)
                    if match and not url:
                        url = match.group(1)
                    
                    if "Or, paste the authorization code here" in out_str or "Waiting for authentication" in out_str:
                        if url:
                            global_auth_session.auth_url = url
                            return {"success": True, "url": url}
            except OSError as e:
                logger.error(f"PTY read error: {e}")
                break

        global_auth_session.clear()
        return {"success": False, "error": "Failed to extract authentication URL from agy."}

async def submit_auth_code(code: str) -> Dict[str, str]:
    """Submits the pasted code to the running PTY session."""
    global global_auth_session
    if not global_auth_session.is_active or global_auth_session.fd is None:
        return {"success": False, "error": "No active authentication session."}

    fd = global_auth_session.fd
    try:
        # Write code + newline
        os.write(fd, (code.strip() + "\n").encode())
        
        output = b""
        start_time = time.time()
        
        # Wait for success or error
        while time.time() - start_time < 10:
            await asyncio.sleep(0.1)
            import select
            r, _, _ = select.select([fd], [], [], 0)
            if r:
                try:
                    chunk = os.read(fd, 1024)
                    output += chunk
                    out_str = output.decode(errors='replace')
                    
                    if "authentication failed" in out_str.lower():
                        global_auth_session.clear()
                        return {"success": False, "error": "Authentication failed. Invalid code."}
                    
                    if "ping" in out_str.lower() or "authentication successful" in out_str.lower() or "logged in" in out_str.lower():
                        # If it proceeds to answer the ping, it means success!
                        pass
                except OSError:
                    # Process might have exited after success
                    break
                    
        # If it didn't explicitly say failed, assume success because it usually proceeds to generate the response
        global_auth_session.clear()
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Error submitting auth code: {e}")
        global_auth_session.clear()
        return {"success": False, "error": str(e)}
