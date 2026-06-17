"""SQLite persistence layer: projects, jobs, and event audit log."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Optional

_DB_PATH = Path(__file__).parent.parent / "data" / "localwiki.db"
_SCHEMA_PATH = Path(__file__).parent / "schema.sql"


@contextmanager
def _conn() -> Generator[sqlite3.Connection, None, None]:
    con = sqlite3.connect(_DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema = _SCHEMA_PATH.read_text()
    with _conn() as con:
        con.executescript(schema)
        # Idempotent migrations for existing databases
        for stmt in [
            "ALTER TABLE jobs ADD COLUMN parent_job_id TEXT REFERENCES jobs(id)",
            "ALTER TABLE projects ADD COLUMN slug TEXT",
            "ALTER TABLE projects ADD COLUMN project_key TEXT",
        ]:
            try:
                con.execute(stmt)
            except Exception:
                pass  # Column already exists
        # Backfill slug and project_key for rows that predate the migration
        con.execute("UPDATE projects SET slug = repo WHERE slug IS NULL")
        con.execute(
            "UPDATE projects SET project_key = lower(hex(randomblob(16))) WHERE project_key IS NULL"
        )
        try:
            con.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)"
            )
            con.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_key ON projects(project_key)"
            )
        except Exception:
            pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class ProjectStore:
    def upsert(
        self,
        project_id: str,
        owner: str,
        repo: str,
        language: str = "ko",
        model: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        now = _now()
        with _conn() as con:
            con.execute(
                """
                INSERT INTO projects (id, owner, repo, language, model, slug, project_key, created_at, updated_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    language = excluded.language,
                    model = excluded.model,
                    updated_at = excluded.updated_at,
                    metadata = excluded.metadata
                """,
                (
                    project_id,
                    owner,
                    repo,
                    language,
                    model,
                    repo,
                    now,
                    now,
                    json.dumps(metadata) if metadata else None,
                ),
            )

    def get(self, project_id: str) -> Optional[dict]:
        with _conn() as con:
            row = con.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return dict(row) if row else None

    def list_all(self) -> list[dict]:
        with _conn() as con:
            rows = con.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def get_by_slug(self, slug: str) -> Optional[dict]:
        with _conn() as con:
            row = con.execute(
                "SELECT * FROM projects WHERE slug = ? ORDER BY updated_at DESC LIMIT 1",
                (slug,),
            ).fetchone()
            return dict(row) if row else None

    def delete(self, project_id: str) -> None:
        with _conn() as con:
            # Remove checkpoints for all jobs belonging to this project
            con.execute(
                "DELETE FROM page_checkpoints WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
                (project_id,),
            )
            con.execute("DELETE FROM jobs WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM projects WHERE id = ?", (project_id,))


class JobStore:
    def create(self, job_id: str, project_id: Optional[str] = None) -> None:
        with _conn() as con:
            con.execute(
                """
                INSERT OR IGNORE INTO jobs (id, project_id, status, started_at)
                VALUES (?, ?, 'pending', ?)
                """,
                (job_id, project_id, _now()),
            )

    def start(self, job_id: str) -> None:
        with _conn() as con:
            con.execute(
                "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
                (_now(), job_id),
            )

    def update_phase(self, job_id: str, phase: str) -> None:
        with _conn() as con:
            con.execute(
                "UPDATE jobs SET current_phase = ? WHERE id = ?",
                (phase, job_id),
            )

    def update_page_counts(
        self,
        job_id: str,
        page_total: Optional[int] = None,
        page_done_delta: int = 0,
        page_failed_delta: int = 0,
    ) -> None:
        with _conn() as con:
            if page_total is not None:
                con.execute(
                    "UPDATE jobs SET page_total = ? WHERE id = ?",
                    (page_total, job_id),
                )
            if page_done_delta:
                con.execute(
                    "UPDATE jobs SET page_done = page_done + ? WHERE id = ?",
                    (page_done_delta, job_id),
                )
            if page_failed_delta:
                con.execute(
                    "UPDATE jobs SET page_failed = page_failed + ? WHERE id = ?",
                    (page_failed_delta, job_id),
                )

    def complete(self, job_id: str, duration_ms: int) -> None:
        with _conn() as con:
            con.execute(
                """
                UPDATE jobs SET status = 'completed', completed_at = ?, duration_ms = ?
                WHERE id = ?
                """,
                (_now(), duration_ms, job_id),
            )

    def fail(self, job_id: str, error: str) -> None:
        with _conn() as con:
            con.execute(
                "UPDATE jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
                (_now(), error[:2000], job_id),
            )

    def interrupt(self, job_id: str, error: str) -> None:
        """Mark job as interrupted (rate limit / quota) — resumable."""
        with _conn() as con:
            con.execute(
                "UPDATE jobs SET status = 'interrupted', completed_at = ?, error = ? WHERE id = ?",
                (_now(), error[:2000], job_id),
            )

    def create_resume(self, project_id: Optional[str], parent_job_id: str) -> str:
        """Create a new job that continues a previously interrupted job."""
        import uuid
        new_id = str(uuid.uuid4())
        with _conn() as con:
            # Mark parent as 'resumed' so it no longer shows in the interrupted list
            con.execute(
                "UPDATE jobs SET status = 'resumed' WHERE id = ?",
                (parent_job_id,),
            )
            con.execute(
                """
                INSERT INTO jobs (id, project_id, status, started_at, parent_job_id)
                VALUES (?, ?, 'pending', ?, ?)
                """,
                (new_id, project_id, _now(), parent_job_id),
            )
        return new_id

    def dismiss(self, job_id: str) -> None:
        """Remove an interrupted job entry (user dismissed it)."""
        with _conn() as con:
            con.execute("DELETE FROM jobs WHERE id = ? AND status = 'interrupted'", (job_id,))

    def get(self, job_id: str) -> Optional[dict]:
        with _conn() as con:
            row = con.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            return dict(row) if row else None

    def list(
        self,
        project_id: Optional[str] = None,
        limit: int = 20,
        status_filter: Optional[str] = None,
    ) -> list[dict]:
        with _conn() as con:
            conditions = []
            params: list = []
            if project_id:
                conditions.append("project_id = ?")
                params.append(project_id)
            if status_filter:
                conditions.append("status = ?")
                params.append(status_filter)
            where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
            params.append(limit)
            rows = con.execute(
                f"SELECT * FROM jobs {where} ORDER BY started_at DESC LIMIT ?",
                params,
            ).fetchall()
            return [dict(r) for r in rows]


class EventStore:
    def append(
        self,
        job_id: str,
        seq: int,
        event_type: str,
        phase: Optional[str],
        message: str,
        data: dict[str, Any],
        ts: str,
    ) -> None:
        with _conn() as con:
            con.execute(
                """
                INSERT INTO events (job_id, seq, type, phase, message, data, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, seq, event_type, phase, message, json.dumps(data), ts),
            )

    def get_events(self, job_id: str, since_seq: int = 0) -> list[dict]:
        with _conn() as con:
            rows = con.execute(
                """
                SELECT * FROM events
                WHERE job_id = ? AND seq > ?
                ORDER BY seq
                """,
                (job_id, since_seq),
            ).fetchall()
            result = []
            for r in rows:
                row = dict(r)
                try:
                    row["data"] = json.loads(row["data"])
                except (json.JSONDecodeError, TypeError):
                    row["data"] = {}
                result.append(row)
            return result


class SettingsStore:
    def get(self, key: str) -> Optional[dict]:
        with _conn() as con:
            row = con.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                return None
            try:
                return json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                return None

    def set(self, key: str, value: dict) -> None:
        with _conn() as con:
            con.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, json.dumps(value), _now()),
            )


class PageCheckpointStore:
    def mark_completed(self, job_id: str, page_id: str, page_title: str, content: str = "") -> None:
        with _conn() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO page_checkpoints (job_id, page_id, page_title, status, completed_at, content)
                VALUES (?, ?, ?, 'completed', ?, ?)
                """,
                (job_id, page_id, page_title, _now(), content),
            )

    def get_completed_ids(self, job_id: str) -> list[str]:
        with _conn() as con:
            rows = con.execute(
                "SELECT page_id FROM page_checkpoints WHERE job_id = ? AND status = 'completed'",
                (job_id,),
            ).fetchall()
            return [r["page_id"] for r in rows]

    def get_completed_with_content(self, job_id: str) -> list[dict]:
        with _conn() as con:
            rows = con.execute(
                "SELECT page_id, page_title, content FROM page_checkpoints WHERE job_id = ? AND status = 'completed'",
                (job_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def count(self, job_id: str) -> int:
        with _conn() as con:
            row = con.execute(
                "SELECT COUNT(*) as n FROM page_checkpoints WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            return row["n"] if row else 0


# Module-level singletons
project_store = ProjectStore()
job_store = JobStore()
event_store = EventStore()
settings_store = SettingsStore()
page_checkpoint_store = PageCheckpointStore()
