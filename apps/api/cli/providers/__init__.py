"""
Provider factory — resolves provider name to a concrete LLM adapter.

Two provider families:
  1. API-key providers: gemini, claude, openai/codex/gpt
  2. CLI subscription providers: gemini-cli, codex-cli, claude-cli
     These call the locally-installed CLI tools (no API key needed).
"""
from __future__ import annotations

from typing import Any


def get_provider(provider: str, model: str | None = None, cwd: str = ".", **kwargs: Any):
    """
    Return an LLM provider instance by name.

    API-key providers (require env vars):
      - "gemini"      → GeminiProvider  (GEMINI_API_KEY / GOOGLE_API_KEY)
      - "claude"      → ClaudeProvider  (ANTHROPIC_API_KEY)
      - "openai"      → OpenAIProvider  (OPENAI_API_KEY)

    CLI subscription providers (no API key — uses installed CLIs):
      - "gemini-cli"  → CLIAgentProvider("gemini")
      - "codex-cli"   → CLIAgentProvider("codex")
      - "claude-cli"  → CLIAgentProvider("claude")
      - "antigravity-cli" → CLIAgentProvider("antigravity")
    """
    name = provider.lower().strip()

    # ── CLI subscription providers ────────────────────────────────────────
    if name in ("gemini-cli", "gemini-sub"):
        from cli.providers.cli_agent import CLIAgentProvider
        return CLIAgentProvider("gemini", model=model, cwd=cwd, **kwargs)

    if name in ("codex-cli", "codex-sub", "openai-cli"):
        from cli.providers.cli_agent import CLIAgentProvider
        return CLIAgentProvider("codex", model=model, cwd=cwd, **kwargs)

    if name in ("claude-cli", "claude-sub", "anthropic-cli"):
        from cli.providers.cli_agent import CLIAgentProvider
        return CLIAgentProvider("claude", model=model, cwd=cwd, **kwargs)

    if name in ("antigravity-cli", "agy-cli", "antigravity-sub", "agy-sub"):
        from cli.providers.cli_agent import CLIAgentProvider
        return CLIAgentProvider("antigravity", model=model, cwd=cwd, **kwargs)

    # ── API-key providers ─────────────────────────────────────────────────
    if name == "gemini":
        from cli.providers.gemini import GeminiProvider
        return GeminiProvider(model=model, **kwargs)

    if name in ("claude", "anthropic"):
        from cli.providers.claude import ClaudeProvider
        return ClaudeProvider(model=model, **kwargs)

    if name in ("openai", "codex", "gpt"):
        from cli.providers.openai_wrap import OpenAIProvider
        return OpenAIProvider(model=model, **kwargs)

    raise ValueError(
        f"Unknown provider '{provider}'. "
        "API-key: gemini, claude, openai. "
        "CLI (subscription): gemini-cli, codex-cli, claude-cli, antigravity-cli"
    )


def list_providers() -> dict[str, list[str]]:
    """Return all available provider names grouped by type."""
    return {
        "api_key": ["gemini", "claude", "openai", "codex", "gpt"],
        "cli_subscription": ["gemini-cli", "codex-cli", "claude-cli", "antigravity-cli"],
    }


__all__ = ["get_provider", "list_providers"]
