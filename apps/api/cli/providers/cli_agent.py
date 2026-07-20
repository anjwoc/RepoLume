"""
CLIAgentProvider — wraps local CLI agents as an LLM provider.

Instead of API keys, this provider uses the user's already-authenticated
subscription CLI tools (Gemini, Codex, Claude Code, Antigravity) via the
Python-native agent_runner module.
"""
from __future__ import annotations

import asyncio
import logging

from api.agent_runner import AgentRegistry, RunResult

logger = logging.getLogger(__name__)


class CLIAgentProvider:
    """
    LLM provider backed by a locally-installed CLI (Gemini/Codex/Claude/agy).

    Uses ``api.agent_runner`` (Python asyncio) instead of the old Go binary.
    No API keys required — uses the user's subscription auth.

    Usage::

        provider = CLIAgentProvider("gemini", model="gemini-2.5-flash")
        text = provider.generate("Write a wiki page about auth...")
    """

    def __init__(
        self,
        agent: str,  # "gemini" | "codex" | "claude" | "antigravity"
        model: str | None = None,
        cwd: str = ".",
        timeout: int = 300,
    ):
        self.agent = agent
        self.model = model or ""
        self.cwd = cwd
        self.timeout = timeout
        self._registry = AgentRegistry(
            gemini_model=self.model if agent == "gemini" else "",
            codex_model=self.model if agent == "codex" else "",
            claude_model=self.model if agent == "claude" else "",
        )

    # ------------------------------------------------------------------ #

    def generate(self, prompt: str, event_sink=None) -> str:
        """Send prompt to the CLI agent and return the generated text."""
        runner = self._registry.get(self.agent)
        if not runner.available():
            raise RuntimeError(
                f"{self.agent} CLI not found on PATH. "
                f"Install the '{runner.cli_binary}' tool first."
            )

        if event_sink is not None:
            return self._generate_streaming(prompt, event_sink)

        # Synchronous collect
        result: RunResult = asyncio.run(
            runner.run_collect(
                prompt=prompt,
                cwd=self.cwd,
                model=self.model,
                timeout=self.timeout,
            )
        )

        if result.error and not result.content:
            raise RuntimeError(f"Agent error ({self.agent}): {result.error}")
        if result.error:
            logger.error(f"Agent stderr ({self.agent}): {result.error}")

        logger.info(
            f"[{self.agent}/{result.model}] "
            f"{len(result.content)} chars in {result.elapsed_ms}ms"
        )
        return result.content

    def _generate_streaming(self, prompt: str, event_sink) -> str:
        """Run agent in streaming mode and forward events to event_sink."""

        async def _run() -> str:
            runner = self._registry.get(self.agent)
            content_parts: list[str] = []
            async for event in runner.run_stream_jsonl(
                prompt=prompt,
                cwd=self.cwd,
                model=self.model,
                timeout=self.timeout,
            ):
                ev_dict = {
                    "type": event.type,
                    "agent": event.agent,
                    "model": event.model,
                    "content": event.content,
                    "error": event.error,
                    "elapsed_ms": event.elapsed_ms,
                }
                if event.type == "chunk":
                    content_parts.append(event.content)
                elif event.type == "complete" and event.content:
                    content_parts = [event.content]
                if callable(event_sink):
                    event_sink(ev_dict)
            return "".join(content_parts).strip()

        return asyncio.run(_run())

    def check_available(self) -> bool:
        """Return True if the underlying CLI agent is installed."""
        try:
            runner = self._registry.get(self.agent)
            return runner.available()
        except Exception:
            return False
