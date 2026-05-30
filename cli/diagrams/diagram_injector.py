"""
Diagram Injector — merges CodeBoarding Mermaid diagrams into wiki pages.

Strategy:
1. Find the "Architecture" or "System Architecture" section in the wiki page.
2. If none, find an H2 section mentioning "component", "design", "overview", or "structure".
3. Inject the best-matching diagram from the DiagramCollection after the section heading.
4. Append the overview architecture diagram at the top of the page if not yet injected.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, Optional, Tuple

from cli.diagrams.mermaid_extractor import DiagramCollection, MermaidDiagram
from cli.pipeline.structure_planner import WikiPage

logger = logging.getLogger(__name__)

# Keywords that suggest an architecture/design section
_ARCH_KEYWORDS = {
    "architecture", "component", "design", "overview", "structure",
    "system", "diagram", "flow", "아키텍처", "구조", "설계", "개요",
    # Japanese
    "アーキテクチャ", "概要", "構造",
}

_H2_RE = re.compile(r"^(## .+)$", re.MULTILINE)
_MERMAID_FENCE_RE = re.compile(r"```mermaid", re.IGNORECASE)


def _has_mermaid(content: str) -> bool:
    return bool(_MERMAID_FENCE_RE.search(content))


def _wrap_mermaid(diagram: MermaidDiagram, caption: str = "") -> str:
    """Format a MermaidDiagram for insertion into a wiki page."""
    lines = ["```mermaid", diagram.content, "```"]
    if caption:
        lines.append(f"\n*{caption}*\n")
    return "\n".join(lines)


def _find_best_injection_point(content: str, topic: str) -> Optional[Tuple[int, str]]:
    """
    Return (char_offset, section_title) of the best H2 to inject after.
    Returns None if no suitable section found.
    """
    topic_words = set(topic.lower().split())

    best_score = -1
    best_match: Optional[Tuple[int, str]] = None

    for m in _H2_RE.finditer(content):
        heading = m.group(1)
        heading_lower = heading.lower()

        score = 0
        # Keyword match
        for kw in _ARCH_KEYWORDS:
            if kw in heading_lower:
                score += 2

        # Topic word match
        for word in topic_words:
            if word in heading_lower:
                score += 1

        if score > best_score:
            best_score = score
            # Injection point: end of this heading line
            best_match = (m.end(), heading)

    return best_match if best_score > 0 else None


class DiagramInjector:
    """
    Injects CodeBoarding Mermaid diagrams into generated wiki pages.

    Usage::

        injector = DiagramInjector(diagrams)
        enriched = injector.inject_page(page, content)
    """

    def __init__(self, diagrams: DiagramCollection):
        self._diagrams = diagrams

    def inject_page(self, page: WikiPage, content: str) -> str:
        """
        Inject the most relevant diagram into a wiki page's content.

        Rules:
        - Skip if page already has a Mermaid block (LLM generated one).
        - Try to find the best matching diagram by topic.
        - Fall back to the overall architecture diagram.
        - Inject after the most relevant H2 section, or after the first H1.
        """
        if _has_mermaid(content):
            # Page already has diagrams — don't double-inject
            return content

        # Find best diagram for this page topic
        diagram = (
            self._diagrams.for_topic(page.title)
            or self._diagrams.best_architecture_diagram()
        )
        if diagram is None:
            return content

        injected = _inject_diagram(content, diagram, page.title)
        if injected != content:
            logger.debug(f"Injected diagram into '{page.title}'")
        return injected

    def inject_all(
        self,
        pages: list[WikiPage],
        page_contents: Dict[str, str],
    ) -> Dict[str, str]:
        """Inject diagrams into all pages. Returns updated contents dict."""
        result = {}
        for page in pages:
            content = page_contents.get(page.id, "")
            result[page.id] = self.inject_page(page, content)
        return result


def _inject_diagram(content: str, diagram: MermaidDiagram, topic: str) -> str:
    """
    Find the best insertion point and return the content with the diagram added.
    """
    fence = _wrap_mermaid(
        diagram,
        caption=f"Source: {diagram.source_file} — {diagram.heading_context or 'Architecture Overview'}",
    )
    injection = f"\n\n{fence}\n"

    # Try best-matching H2 section
    point = _find_best_injection_point(content, topic)
    if point:
        offset, _ = point
        return content[:offset] + injection + content[offset:]

    # Fallback: inject after H1 title line
    h1 = re.search(r"^# .+$", content, re.MULTILINE)
    if h1:
        pos = h1.end()
        return content[:pos] + injection + content[pos:]

    # Last resort: prepend
    return injection + content
