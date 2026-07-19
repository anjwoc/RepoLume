from __future__ import annotations

import asyncio
import json

import pytest

from api.background_jobs import BackgroundJobRegistry
from api.chat import handler
from api.db.generation_jobs import GenerationJobStore, TaskDefinition


class FakeJobStore:
    def __init__(self) -> None:
        self.completed: list[tuple[str, int]] = []
        self.failed: list[tuple[str, str]] = []
        self.interrupted: list[tuple[str, str]] = []

    def complete(self, job_id: str, duration_ms: int) -> None:
        self.completed.append((job_id, duration_ms))

    def fail(self, job_id: str, error: str) -> None:
        self.failed.append((job_id, error))

    def interrupt(self, job_id: str, error: str) -> None:
        self.interrupted.append((job_id, error))


@pytest.fixture
def background_context(tmp_path, monkeypatch):
    ledger = GenerationJobStore(tmp_path / "jobs.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "api")])
    jobs = FakeJobStore()
    events: list[tuple[str, str]] = []

    async def emit(job_id, event_type, message="", phase=None, data=None):
        events.append((job_id, event_type))

    monkeypatch.setattr(handler, "generation_job_store", ledger)
    monkeypatch.setattr(handler, "job_store", jobs)
    monkeypatch.setattr(handler, "emit_task_event", emit)
    return ledger, jobs, events


@pytest.mark.asyncio
async def test_background_success_emits_complete_only_after_terminal_attempt(background_context):
    ledger, jobs, events = background_context

    async def stream():
        yield "ok"

    await handler._run_background_stream(stream(), "job-1", "page-1", False)

    assert ledger.get_task("job-1", "page-1")["status"] == "succeeded"
    assert jobs.completed and not jobs.failed
    assert events == [("job-1", "agent.chunk"), ("job-1", "complete")]


@pytest.mark.asyncio
async def test_background_failure_never_emits_complete(background_context):
    ledger, jobs, events = background_context

    async def stream():
        if False:
            yield "unreachable"
        raise RuntimeError("provider failed")

    await handler._run_background_stream(stream(), "job-1", "page-1", False)

    assert ledger.get_task("job-1", "page-1")["status"] == "failed"
    assert jobs.failed == [("job-1", "provider failed")]
    assert not jobs.completed
    assert events == [("job-1", "error")]


@pytest.mark.asyncio
async def test_cancel_propagates_to_the_attempt_and_job(background_context):
    ledger, jobs, events = background_context
    registry = BackgroundJobRegistry()
    started = asyncio.Event()

    async def stream():
        started.set()
        await asyncio.sleep(30)
        yield "unreachable"

    await registry.start(
        "job-1",
        handler._run_background_stream(stream(), "job-1", "page-1", False),
    )
    await asyncio.wait_for(started.wait(), timeout=1)

    assert await registry.cancel("job-1") is True
    assert ledger.get_task("job-1", "page-1")["status"] == "cancelled"
    assert jobs.interrupted == [("job-1", "cancelled")]
    assert events == [("job-1", "cancelled")]
    assert await registry.is_running("job-1") is False


@pytest.mark.asyncio
async def test_cancel_all_waits_for_every_background_job():
    registry = BackgroundJobRegistry()
    started = [asyncio.Event(), asyncio.Event()]

    async def wait_forever(index: int):
        started[index].set()
        await asyncio.sleep(30)

    await registry.start("job-a", wait_forever(0))
    await registry.start("job-b", wait_forever(1))
    await asyncio.gather(*(event.wait() for event in started))

    assert await registry.cancel_all() == 2
    assert await registry.is_running("job-a") is False
    assert await registry.is_running("job-b") is False


@pytest.mark.asyncio
async def test_idle_stream_times_out_without_emitting_complete(
    background_context,
    monkeypatch,
):
    ledger, jobs, events = background_context
    monkeypatch.setattr(handler, "_STREAM_HEARTBEAT_SECONDS", 0.01)
    monkeypatch.setattr(handler, "_STREAM_IDLE_TIMEOUT_SECONDS", 0.04)

    async def stream():
        await asyncio.sleep(30)
        yield "unreachable"

    await handler._run_background_stream(stream(), "job-1", "page-1", False)

    assert ledger.get_task("job-1", "page-1")["status"] == "timed_out"
    assert jobs.failed
    assert not jobs.completed
    assert events[-1] == ("job-1", "error")
    assert ("job-1", "complete") not in events


@pytest.mark.asyncio
async def test_completeness_barrier_rejects_nonterminal_cli_task(background_context):
    ledger, jobs, events = background_context

    async def stream():
        yield "partial"

    await handler._run_background_stream(stream(), "job-1", "page-1", True)

    assert ledger.get_task("job-1", "page-1")["status"] == "queued"
    assert jobs.failed
    assert not jobs.completed
    assert events[-1] == ("job-1", "error")


@pytest.mark.asyncio
async def test_restart_recovery_rebuilds_the_request_for_the_same_job(monkeypatch):
    captured = {}
    events = []

    async def resume(request, *, existing_job_id=None):
        captured["request"] = request
        captured["job_id"] = existing_job_id

    async def emit(*args, **kwargs):
        events.append((args, kwargs))

    monkeypatch.setattr(handler, "_chat_completions_stream", resume)
    monkeypatch.setattr(handler, "emit_task_event", emit)
    reconciled = {
        "job_id": "job-1",
        "task_id": "page-1",
        "attempt_id": "attempt-1",
        "payload_json": json.dumps(
            {
                "request": {
                    "repo_url": ".",
                    "messages": [{"role": "user", "content": "resume"}],
                    "provider": "openrouter",
                    "model": "openai/test",
                }
            }
        ),
    }

    recovered = await handler.resume_requeued_generation(reconciled)

    assert recovered is True
    assert captured["job_id"] == "job-1"
    assert captured["request"].async_mode is True
    assert captured["request"].stream_id == "job-1"
    assert events[-1][0][1] == "task_status"


@pytest.mark.asyncio
async def test_restart_recovery_failure_becomes_terminal_and_visible(tmp_path, monkeypatch):
    ledger = GenerationJobStore(tmp_path / "jobs.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "api")])
    attempt = ledger.begin_attempt("job-1", "page-1")
    reconciled = ledger.reconcile_orphaned_attempts()[0]
    jobs = FakeJobStore()
    events = []

    async def emit(*args, **kwargs):
        events.append((args, kwargs))

    monkeypatch.setattr(handler, "generation_job_store", ledger)
    monkeypatch.setattr(handler, "job_store", jobs)
    monkeypatch.setattr(handler, "emit_task_event", emit)
    reconciled["payload_json"] = "{}"

    recovered = await handler.resume_requeued_generation(reconciled)

    assert recovered is False
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "failed"
    assert task["error_code"] == "restart_recovery_failed"
    assert jobs.failed
    assert events[-1][0][1] == "error"
    assert ledger.get_attempt(attempt.attempt_id)["status"] == "cancelled"
