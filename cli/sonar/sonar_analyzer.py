"""
Sonar Analyzer — main entry point for LocalWiki static analysis.

Orchestrates AST analysis → CallGraph → Mermaid diagram generation.
Results are cached to avoid re-analysis on repeated runs.

Portions adapted from CodeBoarding (MIT License).
This module is the LocalWiki Sonar static-analysis entry point.
"""
from __future__ import annotations

import hashlib
import json
import logging
import pickle
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from cli.sonar.ast_analyzer import ASTAnalyzer
from cli.sonar.call_graph import CallGraph, Node
from cli.sonar.mermaid_gen import (
    generate_mermaid,
    generate_mermaid_for_files,
    generate_overview_diagram,
)
from cli.pipeline.source_tracker import DataSource, SourcedContext

logger = logging.getLogger(__name__)


@dataclass
class Diagram:
    """A generated Mermaid diagram with metadata."""
    title: str
    mermaid: str                   # full ```mermaid ... ``` block
    related_files: list[str] = field(default_factory=list)
    topic_keywords: list[str] = field(default_factory=list)


@dataclass
class DiagramCollection:
    """All diagrams generated for a repository."""
    repo_path: str
    diagrams: list[Diagram] = field(default_factory=list)
    graph: Optional[CallGraph] = None

    def find_for_topic(self, topic: str) -> list[Diagram]:
        """Return diagrams whose topic_keywords match the given topic."""
        topic_lower = topic.lower()
        topic_words = set(topic_lower.replace("_", " ").split())
        matched: list[tuple[int, Diagram]] = []
        for d in self.diagrams:
            score = sum(
                1 for kw in d.topic_keywords
                if kw.lower() in topic_lower or any(w in kw.lower() for w in topic_words)
            )
            if score > 0:
                matched.append((score, d))
        matched.sort(key=lambda x: -x[0])
        return [d for _, d in matched]

    def find_for_files(self, file_paths: list[str]) -> list[Diagram]:
        """Return diagrams related to the given file paths."""
        path_set = set(file_paths)
        return [d for d in self.diagrams if any(f in path_set for f in d.related_files)]

    @property
    def overview(self) -> Optional[Diagram]:
        """Return the overview diagram if present."""
        for d in self.diagrams:
            if "overview" in d.title.lower() or "architecture" in d.title.lower():
                return d
        return self.diagrams[0] if self.diagrams else None


class SonarAnalyzer:
    """
    LocalWiki static analyzer (lightweight, no LSP).

    Generates:
    - Overview architecture diagram (all top nodes)
    - Per-cluster diagrams (by directory/package)
    - On-demand file-specific diagrams

    Results are cached in .localwiki-cache/ within the repo.
    """

    _CACHE_DIR = ".localwiki-cache"

    def __init__(self, repo_path: str, max_files: int = 300):
        self._repo_path = str(Path(repo_path).resolve())
        self._max_files = max_files
        self._ast = ASTAnalyzer()

    def analyze(self, use_cache: bool = True) -> DiagramCollection:
        """
        Run full analysis and return a DiagramCollection.

        Warm-starts from cache if available and source hasn't changed.
        """
        cache_path = self._cache_path()

        if use_cache:
            cached = self._load_cache(cache_path)
            if cached:
                logger.info(f"Sonar: loaded from cache ({len(cached.diagrams)} diagrams)")
                return cached

        logger.info(f"Sonar: analyzing {self._repo_path}...")

        # 1. AST analysis → CallGraph
        graph = self._ast.analyze_repo(self._repo_path, max_files=self._max_files)

        # 2. Generate diagrams
        collection = DiagramCollection(repo_path=self._repo_path, graph=graph)

        # 2a. Overview diagram
        overview_mermaid = generate_overview_diagram(graph)
        if overview_mermaid:
            collection.diagrams.append(Diagram(
                title="Architecture Overview",
                mermaid=overview_mermaid,
                topic_keywords=["overview", "architecture", "system", "all"],
            ))

        # 2b. Per-cluster diagrams (by file directory)
        clusters = graph.cluster_by_file()
        dir_groups = self._group_by_directory(clusters)
        for dir_name, files_and_nodes in dir_groups.items():
            file_paths = list(files_and_nodes.keys())
            cluster_mermaid = generate_mermaid_for_files(graph, file_paths, title=dir_name)
            if cluster_mermaid:
                keywords = self._extract_keywords(dir_name, file_paths)
                collection.diagrams.append(Diagram(
                    title=dir_name,
                    mermaid=cluster_mermaid,
                    related_files=file_paths,
                    topic_keywords=keywords,
                ))

        logger.info(
            f"Sonar: generated {len(collection.diagrams)} diagrams "
            f"from {len(graph.nodes)} nodes"
        )

        self._save_cache(cache_path, collection)
        return collection

    def get_context_for_page(
        self,
        page_title: str,
        file_paths: list[str],
        collection: DiagramCollection | None = None,
    ) -> SourcedContext:
        """
        Build a SourcedContext with AST summary and relevant diagrams.

        Used by WikiPageGenerator to enrich the LLM prompt.
        """
        if collection is None:
            collection = self.analyze()

        parts: list[str] = []

        # 1. AST summary for each file
        ast_summaries: list[str] = []
        for fp in file_paths[:10]:  # cap at 10 files
            syms = self._ast.analyze_file(fp)
            if syms:
                lines = [f"### {Path(fp).name} ({syms.language})"]
                if syms.classes:
                    lines.append(f"- 클래스: {', '.join(syms.classes[:8])}")
                if syms.functions:
                    lines.append(f"- 함수: {', '.join(syms.functions[:8])}")
                if syms.imports:
                    lines.append(f"- 의존: {', '.join(syms.imports[:5])}")
                ast_summaries.append("\n".join(lines))

        if ast_summaries:
            parts.append("## 코드 구조 (AST 분석)\n\n" + "\n\n".join(ast_summaries))

        # 2. Find and attach relevant diagrams
        diagrams = collection.find_for_topic(page_title)
        if not diagrams:
            diagrams = collection.find_for_files(file_paths)
        if not diagrams and collection.overview:
            diagrams = [collection.overview]

        for diagram in diagrams[:2]:  # max 2 diagrams
            parts.append(f"## 아키텍처 다이어그램: {diagram.title}\n\n{diagram.mermaid}")

        content = "\n\n".join(parts)
        source = DataSource(
            type="code",
            name="Static Analysis (LocalWiki)",
            url=self._repo_path,
            excerpt=f"AST: {len(file_paths)} files, {len(diagrams)} diagrams",
            metadata={"source": "localwiki-analyzer", "license": "MIT"},
        )

        score = 25 if ast_summaries else 0
        score += 10 if diagrams else 0
        return SourcedContext(content=content, sources=[source], context_score=score)

    # ── Cache ─────────────────────────────────────────────────────────────────

    def _cache_path(self) -> Path:
        cache_dir = Path(self._repo_path) / self._CACHE_DIR
        cache_dir.mkdir(exist_ok=True)
        repo_hash = hashlib.md5(self._repo_path.encode()).hexdigest()[:8]
        return cache_dir / f"sonar_{repo_hash}.pkl"

    def _load_cache(self, path: Path) -> Optional[DiagramCollection]:
        if not path.is_file():
            return None
        try:
            with open(path, "rb") as f:
                return pickle.load(f)
        except Exception as e:
            logger.debug(f"Cache load failed: {e}")
            return None

    def _save_cache(self, path: Path, collection: DiagramCollection) -> None:
        try:
            with open(path, "wb") as f:
                pickle.dump(collection, f)
        except Exception as e:
            logger.debug(f"Cache save failed: {e}")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _group_by_directory(
        self, clusters: dict[str, list[Node]]
    ) -> dict[str, dict[str, list[Node]]]:
        """Group file-level clusters by parent directory."""
        root = Path(self._repo_path)
        groups: dict[str, dict[str, list[Node]]] = {}
        for fp, nodes in clusters.items():
            try:
                rel = Path(fp).relative_to(root)
                dir_name = str(rel.parent) if str(rel.parent) != "." else "root"
            except ValueError:
                dir_name = "external"
            groups.setdefault(dir_name, {})[fp] = nodes
        # Only include dirs with ≥ 2 files
        return {k: v for k, v in groups.items() if len(v) >= 2}

    def _extract_keywords(self, dir_name: str, file_paths: list[str]) -> list[str]:
        """Extract topic keywords from directory name and file names."""
        words = set()
        # From directory name
        for part in dir_name.replace("/", " ").replace("_", " ").split():
            words.add(part.lower())
        # From file names
        for fp in file_paths:
            stem = Path(fp).stem.replace("_", " ")
            for w in stem.split():
                words.add(w.lower())
        return list(words)
