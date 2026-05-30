"""
Claude (Anthropic) LLM provider adapter for LocalWiki CLI.
Uses anthropic SDK directly.
"""
from __future__ import annotations

import os
import logging
from typing import Iterator

logger = logging.getLogger(__name__)


class ClaudeProvider:
    """Direct Anthropic Claude SDK provider."""

    DEFAULT_MODEL = "claude-sonnet-4-5"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        try:
            import anthropic
        except ImportError:
            raise ImportError(
                "anthropic is required. Install via: pip install anthropic"
            )

        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY is not set. Export it or pass api_key= to ClaudeProvider()."
            )

        self._client = anthropic.Anthropic(api_key=self._api_key)
        self.model_name = model or os.environ.get("CLAUDE_MODEL", self.DEFAULT_MODEL)
        logger.info(f"ClaudeProvider initialized with model: {self.model_name}")

    def generate(self, prompt: str, stream: bool = False) -> str:
        """Generate text from a prompt. Returns full string."""
        if stream:
            return "".join(self.stream(prompt))
        message = self._client.messages.create(
            model=self.model_name,
            max_tokens=65536,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    def stream(self, prompt: str) -> Iterator[str]:
        """Stream text chunks from a prompt."""
        with self._client.messages.stream(
            model=self.model_name,
            max_tokens=65536,
            messages=[{"role": "user", "content": prompt}],
        ) as stream_ctx:
            for text in stream_ctx.text_stream:
                yield text
