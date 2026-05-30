"""
Graph Context Builder — combines codegraph and graphify outputs
into a single compact LLM context string for wiki page generation.

Falls back gracefully through all layers:
  graphify (best, 71.5x token reduction)
  → codegraph (good, ~70% token reduction)
  → raw file reading (existing page_generator behavior)
"""
from __future__ import annotations

import logging
from typing import Optional

from cli.indexer.codegraph_bridge import CodegraphBridge
from cli.indexer.graphify_bridge import GraphifyBridge
from cli.pipeline.structure_planner import WikiPage

logger = logging.getLogger(__name__)


class GraphContext:
    """
    Unified interface for building graph-based LLM context.

    Tries graphify first (best token efficiency), then codegraph,
    then returns empty string so the caller can fall back to raw files.

    Usage::

        ctx = GraphContext(repo_path)
        context = ctx.for_page(page)  # used in page_generator instead of read_file()
    """

    def __init__(self, repo_path: str, auto_index: bool = False):
        """
        Args:
            repo_path: Absolute path to the repository.
            auto_index: If True, attempt to build indexes automatically when missing.
        """
        self._repo_path = repo_path
        self._graphify = GraphifyBridge(repo_path)
        self._codegraph = CodegraphBridge(repo_path)
        self._auto_index = auto_index

        if auto_index:
            self._try_auto_index()

    def _try_auto_index(self) -> None:
        """Attempt to build missing indexes (best-effort, non-fatal)."""
        if not self._graphify.is_available():
            logger.info("Auto-building graphify index…")
            self._graphify.build()

        if not self._codegraph.is_available():
            logger.info("Auto-building codegraph index…")
            self._codegraph.initialize()

    # ------------------------------------------------------------------ #

    def for_page(self, page: WikiPage) -> str:
        """
        Return the best available graph context for a wiki page.

        Token budget comparison:
          Raw files: up to 80,000 chars (MAX_SOURCE_CHARS in page_generator)
          codegraph: typically 2,000–5,000 chars (≈70% reduction)
          graphify:  typically 500–2,000 chars (≈98% reduction / 71.5x)
        """
        # 1. graphify (best)
        ctx = self._graphify.context_for_page(page)
        if ctx:
            logger.debug(f"[graphify] context for '{page.title}': {len(ctx)} chars")
            return ctx

        # 2. codegraph (good)
        ctx = self._codegraph.context_for_page(page)
        if ctx:
            logger.debug(f"[codegraph] context for '{page.title}': {len(ctx)} chars")
            return ctx

        # 3. No index available — caller should use raw file reading
        logger.debug(f"No graph context for '{page.title}' — falling back to file reads")
        return ""

    def status(self) -> dict:
        """Return availability status of each indexer."""
        return {
            "graphify": self._graphify.is_available(),
            "codegraph": self._codegraph.is_available(),
        }

    def architecture_summary(self) -> str:
        """Return high-level architecture summary (for overview pages)."""
        summary = self._graphify.get_architecture_summary()
        if summary:
            return summary
        return ""
