"""
graphify bridge — interfaces with the graphify knowledge-graph tool
(https://github.com/safishamsi/graphify).

graphify uses tree-sitter for deterministic AST extraction and LLMs for
semantic enrichment, storing results in an on-disk knowledge graph.
Queries against the graph use 71.5x fewer tokens than raw file reading.

Setup:
    pip install graphify
    graphify build /path/to/repo
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from cli.pipeline.structure_planner import WikiPage

logger = logging.getLogger(__name__)


class GraphifyBridge:
    """
    Python interface to the graphify knowledge graph.

    Queries the on-disk graph via the `graphify` CLI. Falls back gracefully
    to empty results if graphify is not installed.
    """

    def __init__(self, repo_path: str | Path):
        self.repo_path = Path(repo_path).resolve()
        self._graph_dir = self.repo_path / ".graphify"
        self._available: Optional[bool] = None

    # ------------------------------------------------------------------ #
    # Availability
    # ------------------------------------------------------------------ #

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        has_graph = self._graph_dir.exists()
        has_cli = bool(shutil.which("graphify"))
        self._available = has_graph and has_cli
        if not self._available:
            if not has_graph:
                logger.info(
                    f"graphify graph not found. Run: graphify build {self.repo_path}"
                )
            if not has_cli:
                logger.info("graphify not found in PATH. Install: pip install graphify")
        return self._available

    def build(self, provider_args: Optional[Dict] = None) -> bool:
        """
        Build the graphify knowledge graph for the repo.
        Returns True on success.
        """
        if not shutil.which("graphify"):
            logger.warning("graphify not installed. Run: pip install graphify")
            return False

        logger.info(f"Building graphify graph for {self.repo_path} …")
        cmd = ["graphify", "build", str(self.repo_path)]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0:
            self._available = True
            logger.info("graphify graph built successfully.")
            return True
        logger.warning(f"graphify build failed: {result.stderr[:400]}")
        return False

    # ------------------------------------------------------------------ #
    # Query methods
    # ------------------------------------------------------------------ #

    def query_component(self, name: str) -> str:
        """
        Return a compact text description of a component/class.
        Dramatically fewer tokens than reading the source file.
        """
        result = self._cli_query("component", name)
        if isinstance(result, dict):
            return result.get("description", "") or json.dumps(result, indent=2)
        return str(result) if result else ""

    def get_relationships(self, component: str) -> List[Dict]:
        """Return dependency/relationship list for a component."""
        result = self._cli_query("relationships", component)
        return result if isinstance(result, list) else []

    def export_wiki_page(self, component: str) -> str:
        """
        Ask graphify to generate a wiki-style Markdown page for a component.
        Returns empty string if unavailable.
        """
        result = self._cli_query("wiki", component)
        if isinstance(result, str):
            return result
        if isinstance(result, dict) and "content" in result:
            return result["content"]
        return ""

    def get_architecture_summary(self) -> str:
        """Return high-level architecture summary of the entire repo."""
        result = self._cli_query("summary")
        if isinstance(result, dict):
            return result.get("summary", "")
        return str(result) if result else ""

    def list_components(self) -> List[str]:
        """List all top-level components in the graph."""
        result = self._cli_query("list")
        return result if isinstance(result, list) else []

    # ------------------------------------------------------------------ #
    # Context builder (used by page_generator)
    # ------------------------------------------------------------------ #

    def context_for_page(self, page: WikiPage) -> str:
        """
        Build ultra-compact LLM context for a wiki page using graphify.
        Achieves 71.5x token reduction vs. raw file reading.
        """
        if not self.is_available():
            return ""

        parts: List[str] = [f"## Graphify Knowledge Graph — {page.title}\n"]

        # Try pre-built wiki content for each relevant component
        for word in page.title.split()[:4]:
            wiki_md = self.export_wiki_page(word)
            if wiki_md:
                parts.append(f"### {word} (from graphify)\n{wiki_md[:2000]}")
                rels = self.get_relationships(word)
                if rels:
                    parts.append(
                        "**Dependencies:**\n" +
                        "\n".join(f"- {r.get('target', r)}: {r.get('type','depends')}"
                                  for r in rels[:10])
                    )

        # Architecture summary for overview/architecture pages
        arch_keywords = {"overview", "architecture", "system", "design", "아키텍처", "개요"}
        if any(kw in page.title.lower() for kw in arch_keywords):
            summary = self.get_architecture_summary()
            if summary:
                parts.append(f"### Architecture Summary\n{summary[:3000]}")

        return "\n\n".join(parts) if len(parts) > 1 else ""

    # ------------------------------------------------------------------ #
    # Internal
    # ------------------------------------------------------------------ #

    def _cli_query(self, query_type: str, arg: str = "") -> Any:
        """Execute a graphify CLI query and return parsed result."""
        if not self.is_available():
            return None

        cmd = ["graphify", "query", query_type]
        if arg:
            cmd.append(arg)
        cmd += ["--repo", str(self.repo_path), "--json"]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return json.loads(result.stdout)
                except json.JSONDecodeError:
                    return result.stdout.strip()
        except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
            logger.debug(f"graphify query '{query_type} {arg}' failed: {exc}")
        return None
