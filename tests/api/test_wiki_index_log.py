"""Tests for index.md and log.md generation in save_wiki_cache."""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.routes.cache import save_wiki_cache, _extract_summary
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
        index_path = tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "index.md"
        assert index_path.exists(), "index.md was not created"

    def test_index_md_contains_page_titles(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "index.md").read_text()
        assert "Overview" in content
        assert "Dev Setup" in content

    def test_index_md_contains_section_header(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "index.md").read_text()
        assert "getting-started" in content

    def test_index_md_summary_skips_heading(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "index.md").read_text()
        assert "This is the affiliate system overview." in content
        assert "# Overview" not in content


class TestLogMd:
    def test_log_md_created_on_first_run(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        log_path = tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "log.md"
        assert log_path.exists(), "log.md was not created"

    def test_log_md_contains_repo_and_page_count(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "log.md").read_text()
        assert "affiliate" in content
        assert "2 pages" in content
        assert "gemini-3.5-flash" in content

    def test_log_md_appends_on_second_run(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        asyncio.run(save_wiki_cache(_make_request()))
        log_path = tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "log.md"
        entries = [l for l in log_path.read_text().splitlines() if l.startswith("## [")]
        assert len(entries) == 2, f"Expected 2 log entries, got {len(entries)}"

    def test_log_md_entry_format(self, tmp_path, monkeypatch):
        monkeypatch.setattr("api.routes.cache._PROJECT_ROOT", str(tmp_path))
        asyncio.run(save_wiki_cache(_make_request()))
        content = (tmp_path / "wiki-out" / "affiliate_gemini-3.5-flash" / "log.md").read_text()
        assert re.search(r"^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] generate \|", content, re.MULTILINE)
