from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.server import (  # noqa: E402
    AnalyzeBusinessRequest,
    _business_provider_name,
    _business_repo_paths,
    app,
)


def _write_repo(root: Path, name: str, readme: str) -> Path:
    repo = root / name
    repo.mkdir()
    (repo / "README.md").write_text(readme, encoding="utf-8")
    (repo / "app.py").write_text("def run():\n    return 'ok'\n", encoding="utf-8")
    return repo


def _patch_business_dependencies(monkeypatch, captured: dict):
    import cli.business
    import cli.providers

    def fake_get_provider(provider_name, model=None, cwd=".", **kwargs):
        captured["provider"] = {
            "provider_name": provider_name,
            "model": model,
            "cwd": cwd,
            "kwargs": kwargs,
        }
        return SimpleNamespace(name=provider_name)

    class FakeBusinessAnalyzer:
        def __init__(self, provider, repo, repo_name):
            captured["repo_name"] = repo_name
            captured["file_tree"] = repo.file_tree(max_depth=1)
            captured["readme"] = repo.readme()

        def analyze(self, lang="en"):
            captured["lang"] = lang
            return SimpleNamespace(
                business_summary_md="# Business Overview",
                data_flow_summary_md="# Data Flow",
                workflow_summary_md="# Workflows",
                impact_summary_md="# Impact",
            )

    monkeypatch.setattr(cli.providers, "get_provider", fake_get_provider)
    monkeypatch.setattr(cli.business, "BusinessAnalyzer", FakeBusinessAnalyzer)


def test_business_repo_paths_prefers_repo_urls_and_deduplicates():
    request = AnalyzeBusinessRequest(
        repo_url="/ignored",
        repo_urls=[" /repo/a ", "/repo/b", "/repo/a", ""],
    )

    assert _business_repo_paths(request) == ["/repo/a", "/repo/b"]


def test_business_provider_name_maps_cli_and_api_modes():
    cli_request = AnalyzeBusinessRequest(provider="antigravity", mode="cli", cli_tool="antigravity")
    api_request = AnalyzeBusinessRequest(provider="google", mode="api")

    assert _business_provider_name(cli_request) == "antigravity-cli"
    assert _business_provider_name(api_request) == "gemini"


def test_analyze_business_accepts_single_repo(tmp_path, monkeypatch):
    repo = _write_repo(tmp_path, "orders", "# Orders\n\nOrder workflow.")
    captured: dict = {}
    _patch_business_dependencies(monkeypatch, captured)

    response = TestClient(app).post(
        "/analyze_business",
        json={
            "repo_url": str(repo),
            "language": "ko",
            "provider": "google",
            "mode": "api",
            "model": "gemini-test",
            "api_key": "test-key",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["repo_count"] == 1
    assert data["is_multi_repo"] is False
    assert data["warnings"] == []
    assert set(data["pages"]) == {
        "__business_overview__",
        "__business_dataflow__",
        "__business_workflow__",
        "__business_impact__",
    }
    assert captured["provider"] == {
        "provider_name": "gemini",
        "model": "gemini-test",
        "cwd": str(repo.resolve()),
        "kwargs": {"api_key": "test-key"},
    }
    assert captured["repo_name"] == "orders"
    assert captured["lang"] == "ko"


def test_analyze_business_accepts_multi_repo_and_reports_invalid_paths(tmp_path, monkeypatch):
    repo_a = _write_repo(tmp_path, "orders", "# Orders")
    repo_b = _write_repo(tmp_path, "billing", "# Billing")
    missing = tmp_path / "missing"
    captured: dict = {}
    _patch_business_dependencies(monkeypatch, captured)

    response = TestClient(app).post(
        "/analyze_business",
        json={
            "repo_urls": [str(repo_a), str(missing), str(repo_b)],
            "language": "en",
            "provider": "google",
            "mode": "cli",
            "cli_tool": "gemini",
            "model": "gemini-cli-test",
            "api_key": "should-not-reach-cli-provider",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["repo_count"] == 2
    assert data["is_multi_repo"] is True
    assert len(data["warnings"]) == 1
    assert str(missing) in data["warnings"][0]
    assert captured["provider"]["provider_name"] == "gemini-cli"
    assert captured["provider"]["kwargs"] == {}
    assert "## Repository: orders" in captured["file_tree"]
    assert "## Repository: billing" in captured["file_tree"]
    assert "Root:" in captured["readme"]
    assert captured["repo_name"] == "orders and 1 related repos"


def test_analyze_business_returns_404_when_no_repo_is_valid(tmp_path, monkeypatch):
    captured: dict = {}
    _patch_business_dependencies(monkeypatch, captured)

    response = TestClient(app).post(
        "/analyze_business",
        json={"repo_urls": [str(tmp_path / "missing")], "language": "en"},
    )

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["message"] == "No valid repositories found"
    assert len(detail["warnings"]) == 1
    assert captured == {}
