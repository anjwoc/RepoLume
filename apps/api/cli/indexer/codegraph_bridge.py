"""
codegraph bridge — queries the codegraph SQLite index
(https://github.com/colbymchenry/codegraph) via its CLI.

codegraph uses tree-sitter to index a codebase into a local SQLite database
at .codegraph/index.db. This bridge queries it via the `codegraph` CLI to
retrieve symbol definitions, call graphs, and routes — replacing bulk file
reads with targeted graph queries (≈70% fewer tokens).

Setup:
    npx @colbymchenry/codegraph init -i   # inside the repo
    npx @colbymchenry/codegraph           # starts the MCP server (optional)
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


class CodegraphBridge:
    """
    Thin CLI wrapper around the codegraph tool.

    All queries are executed via `npx @colbymchenry/codegraph query ...`
    and parse the JSON output. Returns empty results gracefully if codegraph
    is not installed or the index doesn't exist.
    """

    def __init__(self, repo_path: str | Path):
        self.repo_path = Path(repo_path).resolve()
        self._available: Optional[bool] = None

    # ------------------------------------------------------------------ #
    # Availability check
    # ------------------------------------------------------------------ #

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available

        index_db = self.repo_path / ".codegraph" / "index.db"
        has_index = index_db.exists()
        has_cli = bool(shutil.which("codegraph") or shutil.which("npx"))

        self._available = has_index and has_cli
        if not self._available:
            if not has_index:
                logger.info(
                    "codegraph index not found. Run: npx @colbymchenry/codegraph init -i "
                    f"inside {self.repo_path}"
                )
            if not has_cli:
                logger.info("codegraph / npx not found in PATH.")
        return self._available

    def initialize(self) -> bool:
        """Run `codegraph init` to build the index. Returns True on success."""
        if not shutil.which("npx"):
            logger.warning("npx not found — cannot initialize codegraph index.")
            return False

        logger.info(f"Initializing codegraph index in {self.repo_path} …")
        result = subprocess.run(
            ["npx", "@colbymchenry/codegraph", "init", "-i"],
            cwd=str(self.repo_path),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            self._available = True
            logger.info("codegraph index built successfully.")
            return True
        logger.warning(f"codegraph init failed: {result.stderr[:300]}")
        return False

    # ------------------------------------------------------------------ #
    # Query methods
    # ------------------------------------------------------------------ #

    def query_symbol(self, name: str) -> Dict[str, Any]:
        """Return definition location and signature for a symbol."""
        return self._query("symbol", name) or {}

    def query_callgraph(self, fn: str) -> List[Dict]:
        """Return list of callers/callees for a function."""
        result = self._query("callgraph", fn)
        return result if isinstance(result, list) else []

    def query_routes(self) -> List[Dict]:
        """Return all detected web routes (URL + handler)."""
        result = self._query("routes")
        return result if isinstance(result, list) else []

    def query_imports(self, file_path: str) -> List[str]:
        """Return import chain for a given file."""
        result = self._query("imports", file_path)
        return result if isinstance(result, list) else []

    # ------------------------------------------------------------------ #
    # Context builder (used by page_generator)
    # ------------------------------------------------------------------ #

    def context_for_page(self, page: WikiPage) -> str:
        """
        Build a compact LLM context string for a wiki page using graph queries.
        Replaces bulk file reading with targeted symbol + call graph lookups.
        """
        if not self.is_available():
            return ""

        parts: List[str] = [f"## Code Graph Context for: {page.title}\n"]

        for fp in page.file_paths[:5]:  # limit per-page files
            imports = self.query_imports(fp)
            if imports:
                parts.append(f"### Imports: `{fp}`\n" + "\n".join(f"- {i}" for i in imports[:20]))

        # Attempt to find symbols related to the page title words
        for word in page.title.split()[:3]:
            sym = self.query_symbol(word)
            if sym:
                parts.append(f"### Symbol: `{word}`\n```\n{json.dumps(sym, indent=2)}\n```")
                calls = self.query_callgraph(word)
                if calls:
                    parts.append(
                        "**Call graph:**\n" +
                        "\n".join(f"- {c.get('name', c)}" for c in calls[:10])
                    )

        # Include routes if this looks like a routing/API page
        route_keywords = {"route", "api", "endpoint", "router", "url", "path"}
        if any(kw in page.title.lower() for kw in route_keywords):
            routes = self.query_routes()
            if routes:
                parts.append("### Routes\n" + "\n".join(
                    f"- `{r.get('method','?')} {r.get('path','?')}` → `{r.get('handler','?')}`"
                    for r in routes[:20]
                ))

        return "\n\n".join(parts)

    # ------------------------------------------------------------------ #
    # Internal
    # ------------------------------------------------------------------ #

    def _query(self, query_type: str, arg: str = "") -> Any:
        """Run a codegraph CLI query and parse JSON output."""
        if not self.is_available():
            return None

        cmd = ["codegraph", "query", query_type]
        if arg:
            cmd.append(arg)

        try:
            result = subprocess.run(
                cmd,
                cwd=str(self.repo_path),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError) as exc:
            logger.debug(f"codegraph query '{query_type} {arg}' failed: {exc}")
        return None
