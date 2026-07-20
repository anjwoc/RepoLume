"""
Wiki Page Generator — generates Markdown content for each WikiPage
using the LLM, with optional parallel execution.
"""
from __future__ import annotations

import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Dict, Optional

from cli.pipeline.structure_planner import WikiPage, WikiStructure, LANGUAGE_NAMES
from cli.prompts import WIKI_PAGE_PROMPT, topic_requirements

logger = logging.getLogger(__name__)

# Max characters of source content to include per page prompt (raw file fallback)
MAX_SOURCE_CHARS = 80_000
# Max chars per individual file snippet
MAX_FILE_CHARS = 12_000


class WikiPageGenerator:
    """
    Generates Markdown content for every page in a WikiStructure.

    Context layers (in order of enrichment):
      1. Sonar AST summary + Mermaid diagram   (+25+10 ctx points)
      2. MCP context (DB schema, Jira, GitHub)  (+up to 45 ctx points)
      3. GraphContext (graphify/codegraph)       (71.5x token reduction)
      4. Raw file reading                        (fallback)

    Model is selected per-page by ModelRouter based on context score.
    All sources are tracked and a citation block is appended to each page.
    """

    def __init__(
        self, provider, repo, repo_name: str,
        indexer=None,
        sonar_collection=None,
        mcp_manager=None,
        model_router=None,
    ):
        self._provider = provider
        self._repo = repo
        self._repo_name = repo_name
        self._indexer = indexer
        self._sonar = sonar_collection    # DiagramCollection | None
        self._mcp = mcp_manager           # MCPManager | None
        self._router = model_router       # ModelRouter | None

    # ------------------------------------------------------------------ #

    def generate_all(
        self,
        structure: WikiStructure,
        lang: str = "en",
        workers: int = 1,
        on_progress: Optional[Callable[[WikiPage, int, int], None]] = None,
    ) -> Dict[str, str]:
        """
        Generate content for all pages.

        Returns:
            {page_id: markdown_content}
        """
        pages = structure.pages
        total = len(pages)
        results: Dict[str, str] = {}

        if workers <= 1:
            for i, page in enumerate(pages, 1):
                if on_progress:
                    on_progress(page, i, total)
                results[page.id] = self._generate_page(page, lang)
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                future_to_page = {
                    executor.submit(self._generate_page, page, lang): page
                    for page in pages
                }
                done = 0
                for future in as_completed(future_to_page):
                    page = future_to_page[future]
                    done += 1
                    if on_progress:
                        on_progress(page, done, total)
                    try:
                        results[page.id] = future.result()
                    except Exception as exc:
                        logger.error(f"Page '{page.title}' failed: {exc}")
                        results[page.id] = f"# {page.title}\n\n> Error generating content: {exc}\n"

        return results

    # ------------------------------------------------------------------ #

    def _generate_page(self, page: WikiPage, lang: str) -> str:
        from cli.pipeline.source_tracker import ContextAssembler, DataSource
        from cli.pipeline.model_router import ContextSignals

        language_name = LANGUAGE_NAMES.get(lang, "English")
        assembler = ContextAssembler()

        # ── Layer 1: Sonar AST summary + diagram ─────────────────────────────
        if self._sonar:
            try:
                from cli.sonar.sonar_analyzer import SonarAnalyzer
                sonar = SonarAnalyzer(str(self._repo.path))
                sonar_ctx = sonar.get_context_for_page(
                    page.title, page.file_paths, self._sonar
                )
                if sonar_ctx:
                    assembler.add(sonar_ctx)
            except Exception as e:
                logger.debug(f"Sonar context error for '{page.title}': {e}")

        # ── Layer 2: MCP context (DB / Jira / GitHub) ─────────────────────────
        if self._mcp:
            try:
                mcp_ctx = self._mcp.collect_context(
                    repo_path=str(self._repo.path),
                    page_topic=page.title,
                    page_files=page.file_paths,
                )
                if mcp_ctx and mcp_ctx.content.strip():
                    assembler.add(mcp_ctx)
            except Exception as e:
                logger.debug(f"MCP context error for '{page.title}': {e}")

        # ── Layer 3: Graph index (token-efficient file reading) ────────────────
        graph_ctx = ""
        if self._indexer:
            graph_ctx = self._indexer.for_page(page)

        if graph_ctx:
            assembler.add_raw(
                graph_ctx,
                DataSource(
                    type="graph_index",
                    name="Graph Index (codegraph/graphify)",
                    url=str(self._repo.path),
                    excerpt=f"{len(graph_ctx)} chars",
                )
            )
            token_mode = "graph-indexed"
        else:
            # ── Layer 4: Raw file reading (fallback) ──────────────────────────
            raw = self._collect_sources(page.file_paths)
            if raw != "(source files not available)":
                assembler.add_raw(
                    raw,
                    DataSource(
                        type="code",
                        name="Source Files",
                        url=str(self._repo.path),
                        excerpt=f"{len(raw)} chars from {len(page.file_paths)} files",
                    )
                )
            token_mode = "raw-files"

        # ── Build final context ───────────────────────────────────────────────
        full_ctx = assembler.build()
        ctx_score = full_ctx.context_score

        # ── Adaptive model selection ──────────────────────────────────────────
        if self._router:
            signals = ContextSignals(
                has_ast_summary=any(s.type == "code" and "AST" in s.name for s in full_ctx.sources),
                has_call_graph=any(s.type == "graph_index" for s in full_ctx.sources),
                has_db_schema=any(s.type == "database" for s in full_ctx.sources),
                has_jira_context=any(s.type == "jira" for s in full_ctx.sources),
                has_github_context=any(s.type == "github" for s in full_ctx.sources),
                has_diagram=any("mermaid" in b.content.lower() for b in [full_ctx]),
                mcp_source_count=assembler.mcp_source_count,
            )
            selected_model = self._router.select(page.importance, signals)
            if hasattr(self._provider, 'model'):
                self._provider.model = selected_model
            logger.debug(self._router.report(page.importance, signals))

        logger.debug(
            f"Generating '{page.title}' via {token_mode} "
            f"(ctx={ctx_score}, chars={len(full_ctx.content)})"
        )

        file_list = "\n".join(f"- {fp}" for fp in page.file_paths) or "(no files specified)"

        has_db_schema = any(s.type == "database" for s in full_ctx.sources)
        prompt = WIKI_PAGE_PROMPT.format(
            page_title=page.title,
            repo_name=self._repo_name,
            file_list=file_list,
            source_contents=full_ctx.content or self._collect_sources(page.file_paths),
            language_name=language_name,
            topic_requirements=topic_requirements(
                getattr(page, "section_id", ""), page.title, has_db_schema
            ),
        )

        try:
            content = self._provider.generate(prompt)
        except Exception as exc:
            logger.error(f"LLM error for page '{page.title}': {exc}")
            content = f"# {page.title}\n\n> Error: {exc}\n"

        content = content.strip()
        content = _strip_outer_fence(content)

        # ── Append citation block ─────────────────────────────────────────────
        if full_ctx.sources:
            from cli.pipeline.source_tracker import ContextAssembler as _A
            content = content + full_ctx.citation_block()

        return content

    def _collect_sources(self, file_paths: list[str]) -> str:
        """Read and concatenate source files up to MAX_SOURCE_CHARS."""
        parts = []
        total = 0
        for fp in file_paths:
            raw = self._repo.read_file(fp)
            if not raw:
                continue
            snippet = raw[:MAX_FILE_CHARS]
            if len(raw) > MAX_FILE_CHARS:
                snippet += f"\n... (file truncated at {MAX_FILE_CHARS} chars)"
            block = f"### File: {fp}\n\n```\n{snippet}\n```\n"
            parts.append(block)
            total += len(block)
            if total >= MAX_SOURCE_CHARS:
                parts.append("... (additional files omitted due to size limit)")
                break
        return "\n".join(parts) if parts else "(source files not available)"


def _strip_outer_fence(text: str) -> str:
    """Remove leading ```markdown and trailing ``` if present."""
    import re
    text = re.sub(r"^```(?:markdown)?\s*\n?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n?```\s*$", "", text)
    return text
