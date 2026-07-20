from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.db.generation_jobs import GenerationJobStore, TaskDefinition


def test_attempt_authority_rejects_late_completion(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks("job-1", [TaskDefinition("page-a", "page")])

    first = store.begin_attempt("job-1", "page-a")
    assert store.fail_attempt(
        first.attempt_id,
        error_code="idle_timeout",
        error_message="no output",
        retryable=True,
    )
    second = store.begin_attempt("job-1", "page-a")

    assert store.complete_attempt(first.attempt_id, {"content": "stale"}) is False
    assert store.complete_attempt(second.attempt_id, {"content": "current"}) is True
    assert store.get_task("job-1", "page-a")["status"] == "succeeded"


def test_completion_is_idempotent_for_the_active_attempt(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks("job-1", [TaskDefinition("page-a", "page")])
    attempt = store.begin_attempt("job-1", "page-a")

    assert store.complete_attempt(attempt.attempt_id, {"content": "ok"}) is True
    assert store.complete_attempt(attempt.attempt_id, {"content": "duplicate"}) is True
    task = store.get_task("job-1", "page-a")
    assert task["status"] == "succeeded"
    assert task["attempt_count"] == 1


def test_circuit_breaker_accumulates_attempts_and_completeness_has_no_gaps(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks(
        "job-1",
        [TaskDefinition("page-a", "page"), TaskDefinition("page-b", "synthesis")],
    )

    for attempt_no in range(1, 4):
        attempt = store.begin_attempt("job-1", "page-a")
        assert attempt.attempt_no == attempt_no
        assert store.fail_attempt(
            attempt.attempt_id,
            error_code="empty_response",
            error_message="empty",
            retryable=True,
            max_attempts=3,
        )

    successful = store.begin_attempt("job-1", "page-b")
    assert store.complete_attempt(successful.attempt_id, {"content": "ok"})

    report = store.completeness("job-1")
    assert report == {
        "expected": 2,
        "queued": 0,
        "running": 0,
        "succeeded": 1,
        "failed": 1,
        "timed_out": 0,
        "cancelled": 0,
        "terminal": 2,
        "non_terminal_task_ids": [],
        "complete": True,
    }
    assert store.get_attempt(attempt.attempt_id)["status"] == "circuit_broken"


def test_completeness_refuses_to_finish_with_queued_or_running_tasks(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks(
        "job-1",
        [TaskDefinition("page-a", "page"), TaskDefinition("page-b", "page")],
    )
    store.begin_attempt("job-1", "page-a")

    report = store.completeness("job-1")
    assert report["complete"] is False
    assert report["non_terminal_task_ids"] == ["page-a", "page-b"]


def test_stale_detection_and_restart_reconciliation(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks("job-1", [TaskDefinition("page-a", "page")])
    attempt = store.begin_attempt("job-1", "page-a")
    stale_at = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(
        timespec="milliseconds"
    )
    with store._open_connection() as connection:
        connection.execute(
            "UPDATE generation_attempts SET last_activity_at = ? WHERE attempt_id = ?",
            (stale_at, attempt.attempt_id),
        )

    stale = store.detect_stale_attempts(600, "job-1")
    orphaned = store.reconcile_orphaned_attempts()

    assert [row["attempt_id"] for row in stale] == [attempt.attempt_id]
    assert [row["attempt_id"] for row in orphaned] == [attempt.attempt_id]
    assert orphaned[0]["requeued"] is True
    assert store.get_attempt(attempt.attempt_id)["status"] == "cancelled"
    assert store.get_task("job-1", "page-a")["status"] == "queued"


def test_restart_reconciliation_fails_tasks_that_are_not_safe_to_replay(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks(
        "job-1",
        [TaskDefinition("page-a", "api", restart_safe=False, max_attempts=3)],
    )
    attempt = store.begin_attempt("job-1", "page-a")

    reconciled = store.reconcile_orphaned_attempts()

    assert reconciled[0]["requeued"] is False
    assert store.get_attempt(attempt.attempt_id)["status"] == "cancelled"
    task = store.get_task("job-1", "page-a")
    assert task["status"] == "failed"
    assert task["error_code"] == "service_restart"


def test_restart_reconciliation_respects_attempt_budget(tmp_path):
    store = GenerationJobStore(tmp_path / "jobs.db")
    store.register_tasks(
        "job-1",
        [TaskDefinition("page-a", "cli", restart_safe=True, max_attempts=1)],
    )
    store.begin_attempt("job-1", "page-a")

    reconciled = store.reconcile_orphaned_attempts()

    assert reconciled[0]["requeued"] is False
    assert store.get_task("job-1", "page-a")["status"] == "failed"
