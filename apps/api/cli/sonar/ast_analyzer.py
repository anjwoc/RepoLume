"""
AST Analyzer — tree-sitter 기반 소스 코드 구조 분석.

Portions adapted from CodeBoarding/static_analyzer/ (MIT License)
Copyright 2025 CodeBoarding Team
https://github.com/CodeBoarding/CodeBoarding

LSP 없이 tree-sitter만으로 클래스/함수/import를 추출합니다.
전체 LSP 파이프라인 대신 경량 AST 분석을 제공합니다.

지원 언어: Python, TypeScript/JavaScript, Go, Java, Rust
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from cli.sonar.call_graph import CallGraph, Node, Edge

logger = logging.getLogger(__name__)

# tree-sitter 언어 패키지 (선택적 의존성)
_TS_AVAILABLE = False
try:
    import tree_sitter_python as tspython
    from tree_sitter import Language, Parser
    _TS_AVAILABLE = True
except ImportError:
    pass


@dataclass
class FileSymbols:
    """Symbols extracted from a single source file."""
    file_path: str
    language: str
    classes: list[str] = field(default_factory=list)
    functions: list[str] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    exports: list[str] = field(default_factory=list)


class ASTAnalyzer:
    """
    Lightweight AST analyzer using tree-sitter.

    Extracts:
    - Classes and their methods
    - Top-level functions
    - Import statements
    - Function calls (for edge building)

    Falls back to regex-based extraction when tree-sitter is unavailable.
    """

    def analyze_file(self, file_path: str) -> Optional[FileSymbols]:
        """Analyze a single file and return its symbols."""
        path = Path(file_path)
        if not path.is_file():
            return None

        lang = self._detect_language(path)
        if not lang:
            return None

        try:
            source = path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.debug(f"Cannot read {file_path}: {e}")
            return None

        symbols = FileSymbols(file_path=file_path, language=lang)

        if _TS_AVAILABLE and lang == "python":
            self._analyze_python_ts(source, symbols)
        else:
            self._analyze_regex(source, lang, symbols)

        return symbols

    def analyze_repo(
        self,
        repo_path: str,
        file_paths: list[str] | None = None,
        max_files: int = 200,
    ) -> CallGraph:
        """
        Analyze a repository and build a CallGraph.

        If file_paths is None, discovers all source files automatically.
        Returns a CallGraph with nodes (components) and edges (dependencies).
        """
        root = Path(repo_path)
        if file_paths is None:
            file_paths = self._discover_files(root, max_files)

        graph = CallGraph()
        file_symbols: dict[str, FileSymbols] = {}

        for fp in file_paths:
            syms = self.analyze_file(fp)
            if syms:
                file_symbols[fp] = syms

        # Build nodes: one node per file (module-level)
        for fp, syms in file_symbols.items():
            rel = str(Path(fp).relative_to(root)) if Path(fp).is_relative_to(root) else fp
            node_id = rel.replace("/", ".").replace("\\", ".").rstrip(".py.ts.js.go.java")
            node = Node(
                id=node_id,
                name=Path(fp).stem,
                file_path=fp,
                kind="module",
                language=syms.language,
                summary=f"{len(syms.classes)} classes, {len(syms.functions)} functions",
            )
            # Add class sub-nodes
            for cls_name in syms.classes:
                cls_node = Node(
                    id=f"{node_id}.{cls_name}",
                    name=cls_name,
                    file_path=fp,
                    kind="class",
                    language=syms.language,
                )
                node.children.append(cls_node)
                graph.add_node(cls_node)
            graph.add_node(node)

        # Build edges: import relationships
        node_by_file = {syms.file_path: nid for nid, syms in
                        [(self._file_to_node_id(fp, root), s)
                         for fp, s in file_symbols.items()]}

        for fp, syms in file_symbols.items():
            src_id = self._file_to_node_id(fp, root)
            for imp in syms.imports:
                # Resolve import to a file
                resolved = self._resolve_import(imp, fp, root, file_symbols)
                if resolved:
                    dst_id = self._file_to_node_id(resolved, root)
                    if src_id != dst_id:
                        graph.add_edge(Edge(src=src_id, dst=dst_id, label="imports"))

        logger.info(f"AST analysis: {len(graph.nodes)} nodes, {len(graph.edges)} edges")
        return graph

    # ── Language Detection ────────────────────────────────────────────────────

    _EXTENSIONS: dict[str, str] = {
        ".py": "python", ".pyw": "python",
        ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
        ".go": "go",
        ".java": "java",
        ".rs": "rust",
        ".rb": "ruby",
        ".cs": "csharp",
        ".php": "php",
    }

    def _detect_language(self, path: Path) -> Optional[str]:
        return self._EXTENSIONS.get(path.suffix.lower())

    # ── Tree-sitter analysis (Python) ─────────────────────────────────────────

    def _analyze_python_ts(self, source: str, symbols: FileSymbols) -> None:
        """Parse Python source with tree-sitter and extract symbols."""
        try:
            PY_LANGUAGE = Language(tspython.language())
            parser = Parser(PY_LANGUAGE)
            tree = parser.parse(source.encode())
            root = tree.root_node

            def walk(node):
                if node.type == "class_definition":
                    name_node = node.child_by_field_name("name")
                    if name_node:
                        symbols.classes.append(name_node.text.decode())
                elif node.type == "function_definition":
                    name_node = node.child_by_field_name("name")
                    if name_node:
                        symbols.functions.append(name_node.text.decode())
                elif node.type in ("import_statement", "import_from_statement"):
                    symbols.imports.append(node.text.decode().split("\n")[0][:100])
                for child in node.children:
                    walk(child)

            walk(root)
        except Exception as e:
            logger.debug(f"tree-sitter parse error: {e}")
            self._analyze_regex(source, "python", symbols)

    # ── Regex fallback ────────────────────────────────────────────────────────

    def _analyze_regex(self, source: str, lang: str, symbols: FileSymbols) -> None:
        """Regex-based extraction when tree-sitter is unavailable."""
        import re
        lines = source.splitlines()
        for line in lines:
            # Python / Ruby / PHP classes
            m = re.match(r"^\s*class\s+(\w+)", line)
            if m:
                symbols.classes.append(m.group(1))
                continue
            # Python functions / Go funcs / Java methods
            m = re.match(r"^\s*(?:def|func|function)\s+(\w+)", line)
            if m:
                symbols.functions.append(m.group(1))
                continue
            # Imports
            m = re.match(r"^\s*(?:import|from|require|use|#include)\s+(.+)", line)
            if m:
                symbols.imports.append(m.group(1).strip()[:80])

    # ── File discovery ────────────────────────────────────────────────────────

    _SKIP_DIRS = {
        ".git", "node_modules", "__pycache__", ".venv", "venv",
        "dist", "build", ".tox", "vendor", "third_party",
    }

    def _discover_files(self, root: Path, max_files: int) -> list[str]:
        files = []
        for path in root.rglob("*"):
            if any(skip in path.parts for skip in self._SKIP_DIRS):
                continue
            if path.is_file() and path.suffix in self._EXTENSIONS:
                files.append(str(path))
                if len(files) >= max_files:
                    break
        return files

    # ── Import resolution ─────────────────────────────────────────────────────

    def _file_to_node_id(self, file_path: str, root: Path) -> str:
        try:
            rel = Path(file_path).relative_to(root)
            return str(rel).replace("/", ".").replace("\\", ".").replace(".py", "")
        except ValueError:
            return Path(file_path).stem

    def _resolve_import(
        self,
        import_str: str,
        from_file: str,
        root: Path,
        file_symbols: dict[str, "FileSymbols"],
    ) -> Optional[str]:
        """Attempt to resolve an import string to an actual file path."""
        import re
        # Extract module name from "from x import y" or "import x"
        m = re.match(r"(?:from\s+(\S+)|import\s+(\S+))", import_str)
        if not m:
            return None
        module = (m.group(1) or m.group(2)).split(".")[0]
        if not module:
            return None

        # Check if any known file matches this module name
        for fp in file_symbols:
            if Path(fp).stem == module:
                return fp
        return None
