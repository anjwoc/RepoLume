from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from api.routes.wiki import _scan_git_roots, get_git_roots


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def test_scan_git_roots_uses_nested_git_metadata_and_tracked_files(tmp_path: Path) -> None:
    project = tmp_path / "bundle"
    repo = project / "packages" / "indexer"
    source = repo / "src" / "index.ts"
    source.parent.mkdir(parents=True)
    source.write_text("export const ok = true;", encoding="utf-8")
    _git(repo, "init")
    _git(repo, "add", "src/index.ts")
    _git(repo, "remote", "add", "origin", "git@github.com:acme/indexer.git")

    roots = _scan_git_roots(str(project))

    assert len(roots) == 1
    assert roots[0]["prefix"] == "packages/indexer"
    assert roots[0]["webUrl"] == "https://github.com/acme/indexer"
    assert roots[0]["localPath"] == str(repo)
    assert roots[0]["files"] == ["src/index.ts"]


def test_git_roots_endpoint_accepts_generation_path_contract(tmp_path: Path) -> None:
    project = tmp_path / "repo"
    project.mkdir()
    (project / "main.py").write_text("print('ok')", encoding="utf-8")
    _git(project, "init")
    _git(project, "add", "main.py")
    _git(project, "remote", "add", "origin", "https://github.com/acme/project.git")

    result = asyncio.run(get_git_roots(path=str(project)))

    assert result["localPath"] == str(project)
    assert result["roots"][0]["files"] == ["main.py"]
