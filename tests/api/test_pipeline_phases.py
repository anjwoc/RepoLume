"""
FastAPI TestClient tests for pipeline phases 2.5 (entity extraction),
phase 3 (MCP cross-check), and admin tracking endpoints.

No live LLM calls, no live MCP servers — all external dependencies mocked.
"""
from __future__ import annotations

import sys
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
from api.server import app

client = TestClient(app, raise_server_exceptions=True)


# ─── Phase 2.5 — Entity Extraction ───────────────────────────────────────────

class TestExtractEntities:
    def test_regex_fallback_extracts_tables(self, tmp_path):
        """Real source file → regex path → db_tables populated."""
        f = tmp_path / "service.py"
        f.write_text(dedent("""
            def fetch():
                return db.execute("SELECT * FROM orders WHERE id = ?", [1])
        """))
        resp = client.post("/api/code/extract-entities", json={
            "project_path": str(tmp_path),
            "file_paths": [str(f)],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "db_tables" in data
        assert "orders" in data["db_tables"]

    def test_empty_directory_returns_empty_entities(self, tmp_path):
        """Empty project dir must return 200 with empty entity lists, not 500."""
        resp = client.post("/api/code/extract-entities", json={
            "project_path": str(tmp_path),
            "file_paths": [],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["db_tables"] == []
        assert data["stored_procs"] == []

    def test_nonexistent_project_path_returns_200(self, tmp_path):
        """Non-existent path should not raise 500 — graceful empty result."""
        resp = client.post("/api/code/extract-entities", json={
            "project_path": str(tmp_path / "nonexistent"),
            "file_paths": [],
        })
        assert resp.status_code == 200

    def test_stream_id_optional(self, tmp_path):
        """stream_id is Optional — omitting it must not cause errors."""
        f = tmp_path / "app.py"
        f.write_text("x = 1")
        resp = client.post("/api/code/extract-entities", json={
            "project_path": str(tmp_path),
            "file_paths": [str(f)],
        })
        assert resp.status_code == 200

    def test_source_field_present(self, tmp_path):
        """Response must always include a 'source' field."""
        resp = client.post("/api/code/extract-entities", json={
            "project_path": str(tmp_path),
            "file_paths": [],
        })
        assert resp.status_code == 200
        assert "source" in resp.json()


# ─── Phase 3 — MCP Cross-Check ───────────────────────────────────────────────

class TestMCPCollect:
    def test_no_config_returns_ok_empty_contexts(self):
        """When no mcp-config.yaml exists, collect must return ok=True, contexts={}."""
        with patch("api.routes.mcp._run_cross_check") as mock_run:
            from api.routes.mcp import MCPCollectResult
            mock_run.return_value = MCPCollectResult(ok=True, contexts={}, skipped=[])

            resp = client.post("/api/mcp/collect", json={
                "project_path": "/tmp/fake_project",
                "entities": {},
                "topic_hint": "",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["contexts"] == {}

    def test_graceful_on_mcp_manager_error(self):
        """If _run_cross_check raises, endpoint must return ok=False, not 500."""
        with patch("api.routes.mcp._run_cross_check", side_effect=RuntimeError("DB down")):
            resp = client.post("/api/mcp/collect", json={
                "project_path": "/tmp/fake",
                "entities": {},
                "topic_hint": "",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False

    def test_contexts_returned_when_mcp_responds(self):
        """When MCPManager provides contexts, they are forwarded to the caller."""
        with patch("api.routes.mcp._run_cross_check") as mock_run:
            from api.routes.mcp import MCPCollectResult
            mock_run.return_value = MCPCollectResult(
                ok=True,
                contexts={"postgresql": "CREATE TABLE orders (...)"},
                skipped=[],
            )
            resp = client.post("/api/mcp/collect", json={
                "project_path": "/tmp/fake",
                "entities": {"db_tables": ["orders"]},
                "topic_hint": "order service",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "postgresql" in data["contexts"]

    def test_disabled_mcp_not_in_contexts(self):
        """Disabled MCP providers must not appear in returned contexts."""
        with patch("api.routes.mcp._run_cross_check") as mock_run:
            from api.routes.mcp import MCPCollectResult
            # Only one provider responded; disabled one was skipped
            mock_run.return_value = MCPCollectResult(
                ok=True,
                contexts={"github": "Recent PR..."},
                skipped=["postgresql"],
            )
            resp = client.post("/api/mcp/collect", json={
                "project_path": "/tmp/fake",
                "entities": {"db_tables": ["users"], "service_names": ["OrderService"]},
                "topic_hint": "",
            })
        data = resp.json()
        assert "github" in data["contexts"]
        assert "postgresql" not in data["contexts"]
        assert "postgresql" in data["skipped"]


# ─── Admin Tracking ───────────────────────────────────────────────────────────

class TestAdminRuns:
    def test_list_runs_empty_db(self):
        """GET /api/admin/runs with empty DB must return runs list, not 500."""
        with patch("api.routes.admin.job_store") as mock_store:
            mock_store.list.return_value = []
            resp = client.get("/api/admin/runs")
        assert resp.status_code == 200
        data = resp.json()
        assert "runs" in data
        assert isinstance(data["runs"], list)

    def test_list_runs_returns_total(self):
        """Response must include a 'total' field."""
        with patch("api.routes.admin.job_store") as mock_store:
            mock_store.list.return_value = []
            resp = client.get("/api/admin/runs")
        assert resp.status_code == 200
        assert "total" in resp.json()

    def test_get_run_not_found_returns_404(self):
        """GET /api/admin/runs/{id} for unknown id must return 404."""
        with patch("api.routes.admin.job_store") as mock_store:
            mock_store.get.return_value = None
            resp = client.get("/api/admin/runs/nonexistent-job-id")
        assert resp.status_code == 404

    def test_get_run_returns_detail(self):
        """GET /api/admin/runs/{id} for known job must return structured detail."""
        fake_job = {
            "id": "job-abc",
            "project_id": "proj-1",
            "status": "completed",
            "started_at": "2026-06-12T10:00:00",
            "ended_at": "2026-06-12T10:01:00",
            "page_total": 5,
            "page_done": 5,
            "page_failed": 0,
        }
        with patch("api.routes.admin.job_store") as mock_js, \
             patch("api.routes.admin.event_store") as mock_es:
            mock_js.get.return_value = fake_job
            mock_es.get_events.return_value = []
            resp = client.get("/api/admin/runs/job-abc")
        assert resp.status_code == 200
        data = resp.json()
        assert data["job_id"] == "job-abc"

    def test_timeline_not_found_returns_404(self):
        """GET /api/admin/runs/{id}/timeline for unknown id must return 404."""
        with patch("api.routes.admin.job_store") as mock_store:
            mock_store.get.return_value = None
            resp = client.get("/api/admin/runs/ghost-id/timeline")
        assert resp.status_code == 404
