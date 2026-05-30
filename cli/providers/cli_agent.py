"""
CLIAgentProvider — wraps the localwiki-agent Go binary as an LLM provider.

Instead of API keys, this provider uses the user's already-authenticated
subscription CLI tools (Gemini, Codex, Claude Code) via the Go binary.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Path to the Go binary (relative to this file or override via env)
_AGENT_BIN = os.environ.get(
    "LOCALWIKI_AGENT_BIN",
    str(Path(__file__).parent.parent.parent / "bin" / "localwiki-agent"),
)


class CLIAgentProvider:
    """
    LLM provider backed by a locally-installed CLI (Gemini/Codex/Claude Code).

    The Go binary ``localwiki-agent`` is invoked as a subprocess and returns
    JSON on stdout.  No API keys required — uses the user's subscription auth.

    Usage::

        provider = CLIAgentProvider("gemini", model="gemini-2.5-flash")
        text = provider.generate("Write a wiki page about auth...")
    """

    def __init__(
        self,
        agent: str,  # "gemini" | "codex" | "claude"
        model: str | None = None,
        cwd: str = ".",
        timeout: int = 300,
    ):
        self.agent = agent
        self.model = model
        self.cwd = cwd
        self.timeout = timeout
        self._bin = _find_agent_bin()

    # ------------------------------------------------------------------ #

    def generate(self, prompt: str) -> str:
        """Send prompt to the CLI agent and return the generated text."""
        if not self._bin:
            raise RuntimeError(
                "localwiki-agent binary not found. "
                "Run: cd localwiki/agent && go build -o ../bin/localwiki-agent ./cmd/localwiki-agent/"
            )

        # Write prompt to a temp file to avoid shell escaping issues
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(prompt)
            prompt_file = f.name

        try:
            cmd = [
                self._bin,
                "run",
                "--agent", self.agent,
                "--prompt-file", prompt_file,
                "--cwd", self.cwd,
                "--timeout", str(self.timeout),
            ]
            if self.model:
                cmd += ["--model", self.model]

            logger.debug(f"Invoking agent: {' '.join(cmd[:5])}...")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout + 10,
            )

            if result.returncode != 0 and not result.stdout:
                raise RuntimeError(
                    f"localwiki-agent exited {result.returncode}: {result.stderr.strip()}"
                )
            if result.returncode != 0:
                logger.error(f"Agent stdout: {result.stdout.strip()}")
                logger.error(f"Agent stderr: {result.stderr.strip()}")

            data = json.loads(result.stdout.strip())

            if data.get("error"):
                raise RuntimeError(f"Agent error ({self.agent}): {data['error']}")

            content = data.get("content", "")
            elapsed = data.get("elapsed_ms", "?")
            logger.info(
                f"[{self.agent}/{data.get('model', '?')}] "
                f"{len(content)} chars in {elapsed}ms"
            )
            return content

        finally:
            os.unlink(prompt_file)

    def check_available(self) -> bool:
        """Return True if the underlying CLI agent is installed."""
        if not self._bin:
            return False
        try:
            result = subprocess.run(
                [self._bin, "check", self.agent],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False


# ─────────────────────────────────────────────────────────────────────────────


def _find_agent_bin() -> str | None:
    """Locate the localwiki-agent binary."""
    candidate = Path(_AGENT_BIN)
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)

    # Also try PATH
    import shutil
    found = shutil.which("localwiki-agent")
    if found:
        return found

    logger.warning(
        f"localwiki-agent binary not found at {_AGENT_BIN}. "
        "Build it first: cd agent && go build -o ../bin/localwiki-agent ./cmd/localwiki-agent/"
    )
    return None
