from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Literal


TaskStatus = Literal["queued", "running", "succeeded", "failed", "timed_out", "cancelled"]
AttemptStatus = Literal[
    "dispatched", "completed", "failed", "timed_out", "cancelled", "circuit_broken"
]
TERMINAL_TASK_STATUSES = frozenset({"succeeded", "failed", "timed_out", "cancelled"})


@dataclass(frozen=True)
class TaskDefinition:
    task_id: str
    kind: str
    payload: dict | None = None
    restart_safe: bool = True
    max_attempts: int = 3
    idempotency_key: str | None = None


@dataclass(frozen=True)
class Attempt:
    attempt_id: str
    job_id: str
    task_id: str
    attempt_no: int


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class GenerationJobStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else (
            Path(
                os.getenv(
                    "LOCALWIKI_DATA_DIR",
                    str(Path(__file__).parent.parent / "data"),
                )
            )
            / "localwiki.db"
        )
        self._schema_ready = False
        self._schema_lock = threading.Lock()

    def _open_connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=5, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _connect(self) -> sqlite3.Connection:
        self._ensure_schema()
        return self._open_connection()

    def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with self._open_connection() as connection:
                connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS generation_tasks (
                    job_id             TEXT NOT NULL,
                    task_id            TEXT NOT NULL,
                    kind               TEXT NOT NULL,
                    payload_json       TEXT NOT NULL DEFAULT '{}',
                    status             TEXT NOT NULL DEFAULT 'queued'
                        CHECK(status IN ('queued','running','succeeded','failed','timed_out','cancelled')),
                    active_attempt_id  TEXT,
                    attempt_count      INTEGER NOT NULL DEFAULT 0,
                    result_json        TEXT,
                    error_code         TEXT,
                    error_message      TEXT,
                    restart_safe       INTEGER NOT NULL DEFAULT 1,
                    max_attempts       INTEGER NOT NULL DEFAULT 3,
                    idempotency_key    TEXT,
                    created_at         TEXT NOT NULL,
                    updated_at         TEXT NOT NULL,
                    finished_at        TEXT,
                    PRIMARY KEY (job_id, task_id)
                );

                CREATE TABLE IF NOT EXISTS generation_attempts (
                    attempt_id       TEXT PRIMARY KEY,
                    job_id           TEXT NOT NULL,
                    task_id          TEXT NOT NULL,
                    attempt_no       INTEGER NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'dispatched'
                        CHECK(status IN ('dispatched','completed','failed','timed_out','cancelled','circuit_broken')),
                    pid              INTEGER,
                    process_group_id INTEGER,
                    process_fingerprint TEXT,
                    started_at       TEXT NOT NULL,
                    last_activity_at TEXT NOT NULL,
                    last_heartbeat_at TEXT,
                    finished_at      TEXT,
                    error_code       TEXT,
                    error_message    TEXT,
                    UNIQUE(job_id, task_id, attempt_no),
                    FOREIGN KEY(job_id, task_id)
                        REFERENCES generation_tasks(job_id, task_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_generation_tasks_status
                    ON generation_tasks(job_id, status);
                CREATE INDEX IF NOT EXISTS idx_generation_attempts_task
                    ON generation_attempts(job_id, task_id, attempt_no);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_attempts_active
                    ON generation_attempts(job_id, task_id)
                    WHERE status = 'dispatched';
                """
                )
                task_columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(generation_tasks)")
                }
                attempt_columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(generation_attempts)")
                }
                for column, definition in (
                    ("restart_safe", "INTEGER NOT NULL DEFAULT 1"),
                    ("max_attempts", "INTEGER NOT NULL DEFAULT 3"),
                    ("idempotency_key", "TEXT"),
                ):
                    if column not in task_columns:
                        connection.execute(
                            f"ALTER TABLE generation_tasks ADD COLUMN {column} {definition}"
                        )
                if "process_fingerprint" not in attempt_columns:
                    connection.execute(
                        "ALTER TABLE generation_attempts "
                        "ADD COLUMN process_fingerprint TEXT"
                    )
            self._schema_ready = True

    def register_tasks(self, job_id: str, tasks: Iterable[TaskDefinition]) -> None:
        now = _now()
        rows = []
        for task in tasks:
            if task.max_attempts < 1:
                raise ValueError("max_attempts must be at least 1")
            rows.append(
                (
                    job_id,
                    task.task_id,
                    task.kind,
                    json.dumps(task.payload or {}),
                    int(task.restart_safe),
                    task.max_attempts,
                    task.idempotency_key or f"{job_id}:{task.task_id}",
                    now,
                    now,
                )
            )
        if not rows:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO generation_tasks
                    (job_id, task_id, kind, payload_json, restart_safe,
                     max_attempts, idempotency_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def begin_attempt(
        self,
        job_id: str,
        task_id: str,
        *,
        pid: int | None = None,
        process_group_id: int | None = None,
    ) -> Attempt:
        now = _now()
        attempt_id = f"attempt_{uuid.uuid4().hex}"
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            task = connection.execute(
                "SELECT * FROM generation_tasks WHERE job_id = ? AND task_id = ?",
                (job_id, task_id),
            ).fetchone()
            if task is None:
                raise KeyError(f"Unknown generation task: {job_id}/{task_id}")
            if task["status"] in TERMINAL_TASK_STATUSES:
                raise ValueError(f"Task {task_id} is already terminal: {task['status']}")
            if task["active_attempt_id"]:
                raise ValueError(f"Task {task_id} already has an active attempt")

            attempt_no = int(task["attempt_count"]) + 1
            connection.execute(
                """
                INSERT INTO generation_attempts
                    (attempt_id, job_id, task_id, attempt_no, status, pid,
                     process_group_id, started_at, last_activity_at)
                VALUES (?, ?, ?, ?, 'dispatched', ?, ?, ?, ?)
                """,
                (
                    attempt_id,
                    job_id,
                    task_id,
                    attempt_no,
                    pid,
                    process_group_id,
                    now,
                    now,
                ),
            )
            connection.execute(
                """
                UPDATE generation_tasks
                SET status = 'running', active_attempt_id = ?, attempt_count = ?,
                    updated_at = ?, finished_at = NULL, error_code = NULL,
                    error_message = NULL
                WHERE job_id = ? AND task_id = ?
                """,
                (attempt_id, attempt_no, now, job_id, task_id),
            )
        return Attempt(attempt_id, job_id, task_id, attempt_no)

    def attach_process(
        self,
        attempt_id: str,
        *,
        pid: int,
        process_group_id: int | None,
        process_fingerprint: str | None = None,
    ) -> bool:
        with self._connect() as connection:
            result = connection.execute(
                """
                UPDATE generation_attempts
                SET pid = ?, process_group_id = ?, process_fingerprint = ?
                WHERE attempt_id = ? AND status = 'dispatched'
                """,
                (pid, process_group_id, process_fingerprint, attempt_id),
            )
            return result.rowcount == 1

    def record_activity(self, attempt_id: str, *, heartbeat: bool = False) -> bool:
        now = _now()
        with self._connect() as connection:
            if heartbeat:
                result = connection.execute(
                    """
                    UPDATE generation_attempts
                    SET last_activity_at = ?, last_heartbeat_at = ?
                    WHERE attempt_id = ? AND status = 'dispatched'
                    """,
                    (now, now, attempt_id),
                )
            else:
                result = connection.execute(
                    """
                    UPDATE generation_attempts
                    SET last_activity_at = ?
                    WHERE attempt_id = ? AND status = 'dispatched'
                    """,
                    (now, attempt_id),
                )
            return result.rowcount == 1

    def complete_attempt(self, attempt_id: str, result: dict | None = None) -> bool:
        now = _now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attempt = connection.execute(
                "SELECT * FROM generation_attempts WHERE attempt_id = ?", (attempt_id,)
            ).fetchone()
            if attempt is None:
                return False
            task = connection.execute(
                "SELECT * FROM generation_tasks WHERE job_id = ? AND task_id = ?",
                (attempt["job_id"], attempt["task_id"]),
            ).fetchone()
            if (
                attempt["status"] == "completed"
                and task is not None
                and task["status"] == "succeeded"
                and task["active_attempt_id"] == attempt_id
            ):
                return True
            if (
                attempt["status"] != "dispatched"
                or task is None
                or task["status"] != "running"
                or task["active_attempt_id"] != attempt_id
            ):
                return False

            connection.execute(
                """
                UPDATE generation_attempts
                SET status = 'completed', finished_at = ?
                WHERE attempt_id = ? AND status = 'dispatched'
                """,
                (now, attempt_id),
            )
            connection.execute(
                """
                UPDATE generation_tasks
                SET status = 'succeeded', result_json = ?, updated_at = ?, finished_at = ?
                WHERE job_id = ? AND task_id = ? AND active_attempt_id = ?
                """,
                (
                    json.dumps(result or {}),
                    now,
                    now,
                    attempt["job_id"],
                    attempt["task_id"],
                    attempt_id,
                ),
            )
            return True

    def fail_attempt(
        self,
        attempt_id: str,
        *,
        error_code: str,
        error_message: str,
        failure_status: Literal["failed", "timed_out", "cancelled"] = "failed",
        retryable: bool = True,
        max_attempts: int = 3,
    ) -> bool:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        now = _now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attempt = connection.execute(
                "SELECT * FROM generation_attempts WHERE attempt_id = ?", (attempt_id,)
            ).fetchone()
            if attempt is None or attempt["status"] != "dispatched":
                return False
            task = connection.execute(
                "SELECT * FROM generation_tasks WHERE job_id = ? AND task_id = ?",
                (attempt["job_id"], attempt["task_id"]),
            ).fetchone()
            if (
                task is None
                or task["status"] != "running"
                or task["active_attempt_id"] != attempt_id
            ):
                return False

            exhausted = retryable and int(attempt["attempt_no"]) >= max_attempts
            attempt_status = "circuit_broken" if exhausted else failure_status
            task_status: TaskStatus = (
                "queued" if retryable and not exhausted else failure_status
            )
            if exhausted:
                task_status = "failed"

            connection.execute(
                """
                UPDATE generation_attempts
                SET status = ?, finished_at = ?, error_code = ?, error_message = ?
                WHERE attempt_id = ? AND status = 'dispatched'
                """,
                (attempt_status, now, error_code, error_message, attempt_id),
            )
            connection.execute(
                """
                UPDATE generation_tasks
                SET status = ?, active_attempt_id = NULL, updated_at = ?,
                    finished_at = ?, error_code = ?, error_message = ?
                WHERE job_id = ? AND task_id = ? AND active_attempt_id = ?
                """,
                (
                    task_status,
                    now,
                    None if task_status == "queued" else now,
                    error_code,
                    error_message,
                    attempt["job_id"],
                    attempt["task_id"],
                    attempt_id,
                ),
            )
            return True

    def get_task(self, job_id: str, task_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM generation_tasks WHERE job_id = ? AND task_id = ?",
                (job_id, task_id),
            ).fetchone()
            return dict(row) if row else None

    def get_attempt(self, attempt_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM generation_attempts WHERE attempt_id = ?", (attempt_id,)
            ).fetchone()
            return dict(row) if row else None

    def detect_stale_attempts(
        self,
        threshold_seconds: float,
        job_id: str | None = None,
    ) -> list[dict]:
        if threshold_seconds <= 0:
            raise ValueError("threshold_seconds must be positive")
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=threshold_seconds)
        ).isoformat(timespec="milliseconds")
        conditions = ["status = 'dispatched'", "last_activity_at <= ?"]
        parameters: list[object] = [cutoff]
        if job_id is not None:
            conditions.append("job_id = ?")
            parameters.append(job_id)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM generation_attempts
                WHERE {' AND '.join(conditions)}
                ORDER BY last_activity_at, attempt_id
                """,
                parameters,
            ).fetchall()
            return [dict(row) for row in rows]

    def list_active_attempts(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT a.*, t.restart_safe, t.max_attempts, t.idempotency_key,
                       t.payload_json, t.kind
                FROM generation_attempts AS a
                JOIN generation_tasks AS t
                  ON t.job_id = a.job_id AND t.task_id = a.task_id
                WHERE a.status = 'dispatched'
                ORDER BY a.started_at, a.attempt_id
                """
            ).fetchall()
            return [dict(row) for row in rows]

    def reconcile_orphaned_attempts(self) -> list[dict]:
        now = _now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                """
                SELECT a.*, t.restart_safe, t.max_attempts, t.idempotency_key,
                       t.payload_json, t.kind
                FROM generation_attempts AS a
                JOIN generation_tasks AS t
                  ON t.job_id = a.job_id AND t.task_id = a.task_id
                WHERE a.status = 'dispatched'
                ORDER BY a.started_at, a.attempt_id
                """
            ).fetchall()
            reconciled: list[dict] = []
            for row in rows:
                requeued = bool(row["restart_safe"]) and int(row["attempt_no"]) < int(
                    row["max_attempts"]
                )
                connection.execute(
                    """
                    UPDATE generation_attempts
                    SET status = 'cancelled', finished_at = ?,
                        error_code = 'service_restart',
                        error_message = 'Execution interrupted by service restart'
                    WHERE attempt_id = ? AND status = 'dispatched'
                    """,
                    (now, row["attempt_id"]),
                )
                connection.execute(
                    """
                    UPDATE generation_tasks
                    SET status = ?, active_attempt_id = NULL,
                        updated_at = ?, finished_at = ?,
                        error_code = 'service_restart',
                        error_message = 'Execution interrupted by service restart'
                    WHERE job_id = ? AND task_id = ?
                      AND active_attempt_id = ? AND status = 'running'
                    """,
                    (
                        "queued" if requeued else "failed",
                        now,
                        None if requeued else now,
                        row["job_id"],
                        row["task_id"],
                        row["attempt_id"],
                    ),
                )
                item = dict(row)
                item["requeued"] = requeued
                reconciled.append(item)
            return reconciled

    def fail_queued_task(
        self,
        job_id: str,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
    ) -> bool:
        now = _now()
        with self._connect() as connection:
            result = connection.execute(
                """
                UPDATE generation_tasks
                SET status = 'failed', updated_at = ?, finished_at = ?,
                    error_code = ?, error_message = ?
                WHERE job_id = ? AND task_id = ? AND status = 'queued'
                  AND active_attempt_id IS NULL
                """,
                (now, now, error_code, error_message, job_id, task_id),
            )
            return result.rowcount == 1

    def completeness(self, job_id: str) -> dict:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT task_id, status FROM generation_tasks WHERE job_id = ? ORDER BY task_id",
                (job_id,),
            ).fetchall()
        counts = {
            status: sum(1 for row in rows if row["status"] == status)
            for status in (
                "queued",
                "running",
                "succeeded",
                "failed",
                "timed_out",
                "cancelled",
            )
        }
        non_terminal = [
            row["task_id"] for row in rows if row["status"] not in TERMINAL_TASK_STATUSES
        ]
        return {
            "expected": len(rows),
            **counts,
            "terminal": len(rows) - len(non_terminal),
            "non_terminal_task_ids": non_terminal,
            "complete": bool(rows) and not non_terminal,
        }


generation_job_store = GenerationJobStore()
