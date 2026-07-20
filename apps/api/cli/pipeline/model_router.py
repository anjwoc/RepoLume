"""
ModelRouter — selects Flash or Pro model based on page importance and
context richness so that even lightweight models produce high-quality docs.

Design principle: quality comes from context, not model size.
The router ensures ~70% of pages use Flash (fast/cheap) and only
high-importance pages with rich multi-source context use Pro.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ContextSignals:
    """
    Signals about how much context is available for a page.
    Higher scores → Flash model can handle it well.
    """
    # Code analysis signals
    has_ast_summary: bool = False        # Local static analysis (+25)
    has_call_graph: bool = False         # codegraph/graphify (+20)
    # MCP signals
    has_db_schema: bool = False          # DBHub MCP (+20)
    has_jira_context: bool = False       # Atlassian MCP (+15)
    has_github_context: bool = False     # GitHub MCP (+10)
    has_diagram: bool = False            # Mermaid diagram context (+10)
    # Raw quality signals
    mcp_source_count: int = 0           # total MCP sources active
    diagram_complexity: int = 0         # number of nodes in diagram

    @property
    def score(self) -> int:
        """Context quality score (0-100). Higher = Flash is sufficient."""
        s = 0
        if self.has_ast_summary:    s += 25
        if self.has_call_graph:     s += 20
        if self.has_db_schema:      s += 20
        if self.has_jira_context:   s += 15
        if self.has_github_context: s += 10
        if self.has_diagram:        s += 10
        return min(s, 100)

    @property
    def has_mcp_sources(self) -> bool:
        return self.mcp_source_count > 0


# Model tables per agent
_MODELS: dict[str, dict[str, str]] = {
    "gemini": {
        "flash":   "gemini-2.5-flash",
        "pro":     "gemini-2.5-pro",
        "default": "gemini-2.5-flash",
    },
    "codex": {
        "flash":   "gpt-5.5",
        "pro":     "gpt-5.5",
        "default": "gpt-5.5",
    },
    "claude": {
        "flash":   "claude-haiku-3-5",
        "pro":     "claude-sonnet-4-5",
        "default": "claude-haiku-3-5",
    },
    # Aliases
    "openai": {
        "flash":   "gpt-4o-mini",
        "pro":     "gpt-4o",
        "default": "gpt-4o-mini",
    },
}


class ModelRouter:
    """
    Selects flash vs pro model based on page importance + context richness.

    Rules:
      - If caller passes an explicit model override → use it always.
      - If page importance == "high" AND context score < 60 → Pro.
      - If page importance == "high" AND context score >= 60 → Flash
        (rich context compensates for lighter model).
      - If mcp_source_count >= 3 → Pro (multi-source synthesis is complex).
      - Otherwise → Flash.

    Result: ~70-80% Flash usage, significant cost saving with no quality drop.
    """

    def __init__(self, agent: str, model_override: str | None = None):
        self._agent = agent.lower()
        self._override = model_override
        self._table = _MODELS.get(self._agent, _MODELS["gemini"])

    def select(self, importance: str, ctx: ContextSignals) -> str:
        """Return the model name to use for this page."""
        if self._override:
            return self._override

        # Explicit Pro triggers
        use_pro = (
            (importance == "high" and ctx.score < 60)   # important + thin context
            or ctx.mcp_source_count >= 3                 # many cross-sources → harder
            or (ctx.has_db_schema and ctx.has_jira_context)  # schema + business context
        )

        tier = "pro" if use_pro else "flash"
        model = self._table.get(tier, self._table["default"])
        return model

    def flash_model(self) -> str:
        return self._override or self._table.get("flash", self._table["default"])

    def pro_model(self) -> str:
        return self._override or self._table.get("pro", self._table["default"])

    def default_model(self) -> str:
        return self._override or self._table.get("default")

    def report(self, importance: str, ctx: ContextSignals) -> str:
        """Human-readable routing decision for logging."""
        model = self.select(importance, ctx)
        tier = "pro" if model == self._table.get("pro") else "flash"
        return (
            f"[router] importance={importance} ctx_score={ctx.score} "
            f"mcp_sources={ctx.mcp_source_count} → {tier} ({model})"
        )
