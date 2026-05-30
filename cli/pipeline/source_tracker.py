"""
Source Tracker — records provenance metadata for every piece of context
used to generate wiki pages, and renders citation sections.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DataSource:
    """
    Provenance record for a single piece of data.

    Fields
    ------
    type      : "code" | "database" | "jira" | "confluence" | "github" | "graph_index"
    name      : human-readable identifier  (e.g. "PostgreSQL", "JIRA-123")
    url       : canonical URL or file path to the original data
    fetched_at: ISO-8601 timestamp when data was fetched
    excerpt   : short excerpt of the data used (≤ 300 chars)
    metadata  : extra structured fields (db_type, branch, etc.)
    """
    type: str
    name: str
    url: str = ""
    fetched_at: str = field(default_factory=lambda: _now())
    excerpt: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_citation_line(self, index: int) -> str:
        parts = [f"{index}. **[{self.type.upper()}]** {self.name}"]
        if self.url:
            parts.append(f"   - 원본: {self.url}")
        parts.append(f"   - 수집: {self.fetched_at}")
        if self.excerpt:
            short = self.excerpt[:200] + ("…" if len(self.excerpt) > 200 else "")
            parts.append(f"   - 내용: {short}")
        return "\n".join(parts)


@dataclass
class SourcedContext:
    """
    A context block together with the sources that produced it.

    Use this as the unit of context passed to page generation so that
    sources are automatically available for citation.
    """
    content: str
    sources: list[DataSource] = field(default_factory=list)
    context_score: int = 0  # 0-100, used by ModelRouter

    def add_source(self, source: DataSource) -> None:
        self.sources.append(source)

    def merge(self, other: "SourcedContext") -> "SourcedContext":
        """Combine two SourcedContexts into one."""
        return SourcedContext(
            content=self.content + "\n\n" + other.content,
            sources=self.sources + other.sources,
            context_score=max(self.context_score, other.context_score),
        )

    def citation_block(self) -> str:
        """Render the citation section for appending to a wiki page."""
        if not self.sources:
            return ""
        lines = [
            "",
            "---",
            "",
            "### 📚 출처 (Sources)",
            "",
            f"> 이 문서는 **{len(self.sources)}개** 데이터 소스를 기반으로 생성되었습니다.",
            "",
        ]
        for i, src in enumerate(self.sources, 1):
            lines.append(src.to_citation_line(i))
            lines.append("")
        return "\n".join(lines)

    @property
    def source_summary(self) -> str:
        """One-liner for the page header."""
        if not self.sources:
            return ""
        types = sorted(set(s.type for s in self.sources))
        return f"소스: {', '.join(types)}"


# ─────────────────────────────────────────────────────────────────────────────
# Context assembler
# ─────────────────────────────────────────────────────────────────────────────

class ContextAssembler:
    """
    Collects SourcedContext blocks from multiple MCP clients and code analyzers,
    computes the context score for ModelRouter, and builds the final
    structured context string passed to the LLM prompt.
    """

    def __init__(self) -> None:
        self._blocks: list[SourcedContext] = []

    def add(self, block: SourcedContext) -> None:
        self._blocks.append(block)

    def add_raw(self, content: str, source: DataSource) -> None:
        self._blocks.append(SourcedContext(content=content, sources=[source]))

    @property
    def all_sources(self) -> list[DataSource]:
        return [s for b in self._blocks for s in b.sources]

    @property
    def mcp_source_count(self) -> int:
        mcp_types = {"database", "jira", "confluence", "github"}
        return len([s for s in self.all_sources if s.type in mcp_types])

    def compute_context_score(self) -> int:
        """Match the ModelRouter.ContextSignals scoring formula."""
        types = {s.type for s in self.all_sources}
        score = 0
        if "code" in types:        score += 25   # AST summary
        if "graph_index" in types: score += 20   # call graph
        if "database" in types:    score += 20   # DB schema
        if "jira" in types or "confluence" in types: score += 15
        if "github" in types:      score += 10
        if any(b.content.startswith("```mermaid") for b in self._blocks): score += 10
        return min(score, 100)

    def build(self) -> SourcedContext:
        """Merge all blocks into a single SourcedContext for the LLM."""
        content_parts: list[str] = []
        all_sources: list[DataSource] = []

        for block in self._blocks:
            if block.content.strip():
                content_parts.append(block.content)
            all_sources.extend(block.sources)

        score = self.compute_context_score()
        return SourcedContext(
            content="\n\n".join(content_parts),
            sources=all_sources,
            context_score=score,
        )

    def inject_citations(self, page_content: str, ctx: SourcedContext) -> str:
        """Append citation block to generated page content."""
        if not ctx.sources:
            return page_content
        return page_content.rstrip() + "\n\n" + ctx.citation_block()


# ─────────────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
