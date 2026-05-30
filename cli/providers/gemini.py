"""
Gemini LLM provider adapter for LocalWiki CLI.
Uses google-generativeai SDK directly (no API server needed).
"""
from __future__ import annotations

import os
import logging
from typing import Iterator

logger = logging.getLogger(__name__)


class GeminiProvider:
    """Direct Gemini SDK provider — no web server required."""

    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        try:
            import google.generativeai as genai
        except ImportError:
            raise ImportError(
                "google-generativeai is required. Install via: pip install google-generativeai"
            )

        self._api_key = (
            api_key
            or os.environ.get("GOOGLE_API_KEY", "")
            or os.environ.get("GEMINI_API_KEY", "")
        )
        if not self._api_key:
            raise ValueError(
                "GOOGLE_API_KEY (or GEMINI_API_KEY) is not set. "
                "Export it or pass api_key= to GeminiProvider()."
            )

        genai.configure(api_key=self._api_key)
        self._genai = genai
        self.model_name = model or os.environ.get("GEMINI_MODEL", self.DEFAULT_MODEL)
        self._client = genai.GenerativeModel(
            model_name=self.model_name,
            generation_config={
                "temperature": 0.7,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 65536,
            },
        )
        logger.info(f"GeminiProvider initialized with model: {self.model_name}")

    def generate(self, prompt: str, stream: bool = False) -> str:
        """Generate text from a prompt. Returns full string."""
        if stream:
            return "".join(self.stream(prompt))
        response = self._client.generate_content(prompt)
        return response.text

    def stream(self, prompt: str) -> Iterator[str]:
        """Stream text chunks from a prompt."""
        response = self._client.generate_content(prompt, stream=True)
        for chunk in response:
            if hasattr(chunk, "text") and chunk.text:
                yield chunk.text
