"""Tests for index.md and log.md generation in save_wiki_cache."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

from api.routes.cache import read_wiki_cache, save_wiki_cache, _extract_summary
from api.routes.models import (
    RepoInfo, WikiCacheRequest, WikiPage, WikiSection, WikiStructureModel,
)


def _make_request() -> WikiCacheRequest:
    pages = {
        "overview": WikiPage(
            id="overview", title="Overview",
            content="# Overview\n\nThis is the affiliate system overview.",
            filePaths=[], importance="high", relatedPages=[],
        ),
        "setup": WikiPage(
            id="setup", title="Dev Setup",
            content="# Dev Setup\n\n> note\n\nInstall dependencies first.",
            filePaths=[], importance="medium", relatedPages=[],
        ),
    }
    sections = [
        WikiSection(id="getting-started", title="Getting Started", pages=["overview", "setup"]),
    ]
    return WikiCacheRequest(
        repo=RepoInfo(owner="local", repo="affiliate", type="local"),
        language="en",
        wiki_structure=WikiStructureModel(
            id="affiliate", title="Affiliate Wiki", description="test",
            pages=list(pages.values()), sections=sections,
        ),
        generated_pages=pages,
        provider="google",
        model="gemini-3.5-flash",
    )


def _output_dir(root: Path) -> Path:
    return root / "wiki-out" / "affiliate_gemini-3.5-flash_01"


class TestExtractSummary:
    def test_skips_heading_returns_first_paragraph(self):
        content = "# Title\n\nFirst paragraph here."
        assert _extract_summary(content) == "First paragraph here."

    def test_skips_blockquote_and_table(self):
        content = "# H\n> quote\n| col |\nActual summary line."
        assert _extract_summary(content) == "Actual summary line."

    def test_truncates_at_160_chars(self):
        content = "# H\n\n" + "x" * 200
        assert len(_extract_summary(content)) == 160

    def test_empty_content_returns_empty(self):
        assert _extract_summary("# Only heading") == ""


class TestIndexMd:
    def test_index_md_created(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        index_path = _output_dir(tmp_path) / "index.md"
        assert index_path.exists(), "index.md was not created"

    def test_index_md_contains_page_titles(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (_output_dir(tmp_path) / "index.md").read_text()
        assert "Overview" in content
        assert "Dev Setup" in content

    def test_index_md_contains_section_header(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (_output_dir(tmp_path) / "index.md").read_text()
        assert "getting-started" in content

    def test_index_md_summary_skips_heading(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (_output_dir(tmp_path) / "index.md").read_text()
        assert "This is the affiliate system overview." in content
        assert "# Overview" not in content


class TestLogMd:
    def test_log_md_created_on_first_run(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        log_path = _output_dir(tmp_path) / "log.md"
        assert log_path.exists(), "log.md was not created"

    def test_log_md_contains_repo_and_page_count(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (_output_dir(tmp_path) / "log.md").read_text()
        assert "affiliate" in content
        assert "2 pages" in content
        assert "gemini-3.5-flash" in content

    def test_log_md_appends_on_second_run(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        asyncio.run(save_wiki_cache(_make_request()))
        log_path = _output_dir(tmp_path) / "log.md"
        entries = [
            line
            for line in log_path.read_text().splitlines()
            if line.startswith("## [")
        ]
        assert len(entries) == 2, f"Expected 2 log entries, got {len(entries)}"

    def test_log_md_entry_format(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (_output_dir(tmp_path) / "log.md").read_text()
        assert re.search(r"^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] generate \|", content, re.MULTILINE)


class TestWikiPathContract:
    def test_cache_keeps_source_and_artifact_paths_separate(self, tmp_path, monkeypatch):
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir()
        monkeypatch.setattr("api.routes.cache.WIKI_CACHE_DIR", str(cache_dir))
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))

        request = _make_request()
        request.repo.localPath = "/workspace/source-repository"

        assert asyncio.run(save_wiki_cache(request)) is True
        cached = asyncio.run(
            read_wiki_cache(
                request.repo.owner,
                request.repo.repo,
                request.repo.type,
                request.language,
                request.model,
            )
        )

        assert cached is not None
        assert cached.source_path == "/workspace/source-repository"
        assert cached.artifact_root == str(_output_dir(tmp_path))
        assert cached.source_path != cached.artifact_root

    def test_incremental_save_does_not_erase_existing_source_path(self, tmp_path, monkeypatch):
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir()
        monkeypatch.setattr("api.routes.cache.WIKI_CACHE_DIR", str(cache_dir))
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))

        initial = _make_request()
        initial.repo.localPath = "/workspace/source-repository"
        assert asyncio.run(save_wiki_cache(initial)) is True

        incremental = _make_request()
        incremental.repo.localPath = None
        assert asyncio.run(save_wiki_cache(incremental)) is True
        cached = asyncio.run(
            read_wiki_cache(
                incremental.repo.owner,
                incremental.repo.repo,
                incremental.repo.type,
                incremental.language,
                incremental.model,
            )
        )

        assert cached is not None
        assert cached.source_path == "/workspace/source-repository"
        assert cached.repo is not None
        assert cached.repo.localPath == "/workspace/source-repository"
