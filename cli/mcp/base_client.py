"""
MCP Base Client — JSON-RPC 2.0 over stdio for any MCP server process.

This implements the minimal MCP client protocol:
  1. Launch the server process
  2. Send `initialize` request
  3. Call tools via `tools/call`
  4. Shutdown

Reference: https://spec.modelcontextprotocol.io/
"""
from __future__ import annotations

import json
import logging
import subprocess
import time
from typing import Any

logger = logging.getLogger(__name__)

_JSONRPC_VERSION = "2.0"
_MCP_PROTOCOL_VERSION = "2024-11-05"


class MCPError(Exception):
    """Raised when an MCP server returns an error or is unavailable."""


class MCPStdioClient:
    """
    Minimal MCP client that speaks JSON-RPC 2.0 over a subprocess's stdin/stdout.

    Usage::

        with MCPStdioClient(["npx", "-y", "dbhub", "--db-type", "postgresql",
                              "--connection-string", "postgresql://..."]) as client:
            result = client.call_tool("list_tables", {})
    """

    def __init__(self, command: list[str], timeout: int = 30, env: dict | None = None):
        self._command = command
        self._timeout = timeout
        self._env = env
        self._proc: subprocess.Popen | None = None
        self._req_id = 0

    def __enter__(self) -> "MCPStdioClient":
        self.start()
        return self

    def __exit__(self, *_) -> None:
        self.stop()

    def start(self) -> None:
        """Launch the MCP server and perform the initialize handshake."""
        import os
        logger.debug(f"Starting MCP server: {' '.join(self._command)}")
        merged_env = {**os.environ, **self._env} if self._env else None
        self._proc = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=merged_env,
        )
        # Give the server a moment to start
        time.sleep(0.5)

        # Initialize handshake
        resp = self._request("initialize", {
            "protocolVersion": _MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "localwiki", "version": "3.0"},
        })
        logger.debug(f"MCP initialize response: {resp.get('serverInfo', {})}")

        # Send initialized notification
        self._notify("notifications/initialized", {})

    def stop(self) -> None:
        """Gracefully terminate the MCP server."""
        if self._proc and self._proc.poll() is None:
            try:
                self._notify("shutdown", {})
            except Exception:
                pass
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None

    def list_tools(self) -> list[dict]:
        """Return the list of tools available on this MCP server."""
        resp = self._request("tools/list", {})
        return resp.get("tools", [])

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """
        Call a named tool on the MCP server.

        Returns the tool's result content (already parsed from JSON-RPC).
        Raises MCPError on server-side errors.
        """
        resp = self._request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })
        # MCP tools/call response has a 'content' array
        content = resp.get("content", [])
        if not content:
            return ""
        # Concatenate text blocks
        parts = [block.get("text", "") for block in content if block.get("type") == "text"]
        return "\n".join(parts)

    # ── private ──────────────────────────────────────────────────────────────

    def _request(self, method: str, params: dict) -> dict:
        """Send a JSON-RPC request and return the result."""
        self._req_id += 1
        msg = {
            "jsonrpc": _JSONRPC_VERSION,
            "id": self._req_id,
            "method": method,
            "params": params,
        }
        self._send(msg)
        return self._recv(self._req_id)

    def _notify(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        msg = {
            "jsonrpc": _JSONRPC_VERSION,
            "method": method,
            "params": params,
        }
        self._send(msg)

    def _send(self, msg: dict) -> None:
        if not self._proc or self._proc.stdin is None:
            raise MCPError("MCP server not running")
        line = json.dumps(msg) + "\n"
        self._proc.stdin.write(line)
        self._proc.stdin.flush()

    def _recv(self, expected_id: int) -> dict:
        """Read lines from stdout until we find the response to expected_id."""
        if not self._proc or self._proc.stdout is None:
            raise MCPError("MCP server not running")
        deadline = time.time() + self._timeout
        while time.time() < deadline:
            line = self._proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                logger.debug(f"Non-JSON from MCP server: {line[:100]}")
                continue

            if msg.get("id") == expected_id:
                if "error" in msg:
                    raise MCPError(f"MCP error: {msg['error']}")
                return msg.get("result", {})
        raise MCPError(f"Timeout waiting for MCP response (method id={expected_id})")
