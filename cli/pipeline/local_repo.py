"""
Local repository scanner for RepoLume CLI.

Reads files from a local directory and produces the file tree string
and README content that the wiki structure planner needs.
Also resolves GitHub/GitLab URLs by cloning into a temp dir.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import logging
import glob
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

# File extensions to index
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cpp", ".c", ".h",
    ".hpp", ".go", ".rs", ".rb", ".php", ".swift", ".cs", ".kt", ".scala",
    ".html", ".css", ".scss", ".sass",
}
DOC_EXTENSIONS = {".md", ".rst", ".txt", ".json", ".yaml", ".yml", ".toml"}

# Directories to always skip
SKIP_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", "dist", "build", "out", "target", "bin",
    ".venv", "venv", "env", "virtualenv", ".idea", ".vscode", "coverage",
    "htmlcov", ".nyc_output", ".tox", "bower_components", "jspm_packages",
    "logs", "log", "tmp", "temp", ".next", ".nuxt", ".output",
}
SKIP_FILES = {
    "yarn.lock", "pnpm-lock.yaml", "package-lock.json", "poetry.lock",
    "uv.lock", "Pipfile.lock", "Cargo.lock", "composer.lock",
    ".DS_Store", "Thumbs.db",
}

# Max file size to read (bytes)
MAX_FILE_BYTES = 512_000  # 512 KB


class LocalRepo:
    """Represents a local (or cloned) repository ready for analysis."""

    def __init__(self, path: str):
        self.path = Path(path).resolve()
        if not self.path.is_dir():
            raise ValueError(f"Not a directory: {self.path}")

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def file_tree(self, max_depth: int = 6) -> str:
        """Return a text representation of the directory tree."""
        lines: List[str] = [str(self.path.name) + "/"]
        self._walk_tree(self.path, lines, prefix="", depth=0, max_depth=max_depth)
        return "\n".join(lines)

    def readme(self) -> str:
        """Return the contents of the first README file found (any extension)."""
        for name in ("README.md", "README.rst", "README.txt", "README", "readme.md"):
            candidate = self.path / name
            if candidate.is_file():
                try:
                    return candidate.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    pass
        return ""

    def read_files(self) -> Dict[str, str]:
        """
        Return {relative_path: content} for all indexable files.
        Skips files that are too large or binary.
        """
        result: Dict[str, str] = {}
        all_extensions = CODE_EXTENSIONS | DOC_EXTENSIONS
        for ext in all_extensions:
            for fpath in self.path.rglob(f"*{ext}"):
                rel = fpath.relative_to(self.path)
                # Skip if any parent dir is in SKIP_DIRS
                if any(part in SKIP_DIRS for part in rel.parts[:-1]):
                    continue
                if fpath.name in SKIP_FILES:
                    continue
                if fpath.stat().st_size > MAX_FILE_BYTES:
                    logger.debug(f"Skipping large file: {rel}")
                    continue
                try:
                    result[str(rel)] = fpath.read_text(encoding="utf-8", errors="replace")
                except OSError as e:
                    logger.warning(f"Cannot read {rel}: {e}")
        logger.info(f"Indexed {len(result)} files from {self.path}")
        return result

    def read_file(self, relative_path: str) -> str:
        """Read a single file by its relative path. Returns empty string on error."""
        target = self.path / relative_path
        if not target.is_file():
            return ""
        try:
            return target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _walk_tree(
        self,
        directory: Path,
        lines: List[str],
        prefix: str,
        depth: int,
        max_depth: int,
    ) -> None:
        if depth >= max_depth:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name))
        except PermissionError:
            return

        entries = [
            e for e in entries
            if not (e.is_dir() and e.name in SKIP_DIRS)
            and not (e.is_file() and e.name in SKIP_FILES)
            and not e.name.startswith(".")
        ]

        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            lines.append(prefix + connector + entry.name + ("/" if entry.is_dir() else ""))
            if entry.is_dir():
                extension = "    " if is_last else "│   "
                self._walk_tree(entry, lines, prefix + extension, depth + 1, max_depth)


# ------------------------------------------------------------------ #
# Factory: resolve a path-or-URL to a LocalRepo
# ------------------------------------------------------------------ #

def resolve_repo(path_or_url: str, clone_dir: str | None = None) -> Tuple[LocalRepo, str | None]:
    """
    Given a local path or a git URL, return (LocalRepo, temp_dir_or_None).
    If a git URL is provided the repo is shallow-cloned into clone_dir
    (or a temp dir). The caller is responsible for cleanup if temp_dir is set.
    """
    p = Path(path_or_url)
    if p.exists() and p.is_dir():
        return LocalRepo(str(p)), None

    # Treat as git URL
    dest = clone_dir or tempfile.mkdtemp(prefix="repolume_")
    logger.info(f"Cloning {path_or_url} → {dest}")
    subprocess.run(
        ["git", "clone", "--depth=1", "--single-branch", path_or_url, dest],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return LocalRepo(dest), dest
