"""
OpenAI/Codex LLM provider adapter for LocalWiki CLI.
Uses openai SDK directly.
"""
from __future__ import annotations

import os
import logging
from typing import Iterator

logger = logging.getLogger(__name__)


class OpenAIProvider:
    """Direct OpenAI SDK provider (also works for Codex-compatible endpoints)."""

    DEFAULT_MODEL = "gpt-4o"

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        try:
            from openai import OpenAI
        except ImportError:
            raise ImportError(
                "openai is required. Install via: pip install openai"
            )

        self._api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "OPENAI_API_KEY is not set. Export it or pass api_key= to OpenAIProvider()."
            )

        _base_url = base_url or os.environ.get("OPENAI_BASE_URL", None)
        self._client = OpenAI(api_key=self._api_key, base_url=_base_url)
        self.model_name = model or os.environ.get("OPENAI_MODEL", self.DEFAULT_MODEL)
        logger.info(f"OpenAIProvider initialized with model: {self.model_name}")

    def generate(self, prompt: str, stream: bool = False) -> str:
        """Generate text from a prompt. Returns full string."""
        if stream:
            return "".join(self.stream(prompt))
        response = self._client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=65536,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""

    def stream(self, prompt: str) -> Iterator[str]:
        """Stream text chunks from a prompt."""
        response = self._client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=65536,
            temperature=0.7,
            stream=True,
        )
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
