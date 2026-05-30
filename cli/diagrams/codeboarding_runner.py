"""
CodeBoarding Runner — executes CodeBoarding analysis on a local repository
and makes the results available to the LocalWiki pipeline.

CodeBoarding (MIT License, Copyright 2025 CodeBoarding) is installed from
/Users/jcjeong/lab/code-sonar/CodeBoarding or via `pip install codeboarding`.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

from cli.diagrams.mermaid_extractor import DiagramCollection, extract_from_directory

logger = logging.getLogger(__name__)

# Default path to the CodeBoarding source already present in the monorepo
_CB_SOURCE = Path(__file__).parent.parent.parent.parent / "CodeBoarding"


def _find_codeboarding_python() -> list[str]:
    """
    Return a command prefix to invoke CodeBoarding.

    Priority:
    1. `codeboarding` in PATH (pip-installed)
    2. `python main.py` inside the local source copy
    """
    if shutil.which("codeboarding"):
        return ["codeboarding"]

    if _CB_SOURCE.is_dir() and (_CB_SOURCE / "main.py").exists():
        logger.debug(f"Using local CodeBoarding source at {_CB_SOURCE}")
        return [sys.executable, str(_CB_SOURCE / "main.py")]

    raise RuntimeError(
        "CodeBoarding not found. Install via: pip install codeboarding\n"
        "Or ensure /Users/jcjeong/lab/code-sonar/CodeBoarding is present."
    )


class CodeBoardingRunner:
    """
    Runs CodeBoarding full analysis on a repo and extracts Mermaid diagrams.

    Usage::

        runner = CodeBoardingRunner()
        collection = runner.analyze("/path/to/repo")
        arch_diagram = collection.best_architecture_diagram()
    """

    def __init__(self, depth_level: int = 1, timeout: int = 300):
        """
        Args:
            depth_level: CodeBoarding diagram depth (1=overview, 2=detailed).
            timeout: Max seconds for the analysis process.
        """
        self.depth_level = depth_level
        self.timeout = timeout

    def analyze(
        self,
        repo_path: str | Path,
        output_dir: Optional[str | Path] = None,
    ) -> DiagramCollection:
        """
        Run `codeboarding full --local <repo>` and return extracted diagrams.

        Args:
            repo_path: Absolute path to the local repository.
            output_dir: Where to write CodeBoarding output.
                        Defaults to <repo>/.codeboarding/

        Returns:
            DiagramCollection with all extracted Mermaid diagrams.
        """
        repo_path = Path(repo_path).resolve()
        cb_out = Path(output_dir).resolve() if output_dir else repo_path / ".codeboarding"

        # Skip if already analyzed and up-to-date
        if cb_out.is_dir() and any(cb_out.glob("*.md")):
            logger.info(
                f"CodeBoarding output already exists at {cb_out}, skipping re-analysis. "
                "Delete .codeboarding/ to force refresh."
            )
            return extract_from_directory(cb_out)

        logger.info(f"Running CodeBoarding analysis on {repo_path} …")
        try:
            cmd_prefix = _find_codeboarding_python()
        except RuntimeError as exc:
            logger.warning(f"CodeBoarding unavailable: {exc}")
            return DiagramCollection()

        cmd = cmd_prefix + [
            "full",
            "--local", str(repo_path),
            "--output-dir", str(cb_out),
            "--depth-level", str(self.depth_level),
        ]

        logger.debug(f"Running: {' '.join(cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=str(_CB_SOURCE) if _CB_SOURCE.is_dir() else None,
            )
            if result.returncode != 0:
                logger.warning(
                    f"CodeBoarding exited with code {result.returncode}.\n"
                    f"stderr: {result.stderr[:500]}"
                )
            else:
                logger.info("CodeBoarding analysis complete.")
        except subprocess.TimeoutExpired:
            logger.warning(f"CodeBoarding timed out after {self.timeout}s — skipping diagrams.")
            return DiagramCollection()
        except FileNotFoundError as exc:
            logger.warning(f"CodeBoarding command not found: {exc}")
            return DiagramCollection()

        return extract_from_directory(cb_out)

    def analyze_incremental(self, repo_path: str | Path) -> DiagramCollection:
        """
        Run incremental update (only changed components).
        Falls back to full analysis if no existing .codeboarding/ found.
        """
        repo_path = Path(repo_path).resolve()
        cb_out = repo_path / ".codeboarding"

        if not cb_out.is_dir():
            logger.info("No existing .codeboarding/ — running full analysis instead.")
            return self.analyze(repo_path)

        try:
            cmd_prefix = _find_codeboarding_python()
        except RuntimeError as exc:
            logger.warning(f"CodeBoarding unavailable: {exc}")
            return extract_from_directory(cb_out)

        cmd = cmd_prefix + ["incremental", "--local", str(repo_path)]
        subprocess.run(
            cmd, capture_output=True, text=True, timeout=self.timeout,
            cwd=str(_CB_SOURCE) if _CB_SOURCE.is_dir() else None,
        )
        return extract_from_directory(cb_out)
