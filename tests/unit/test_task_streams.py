from __future__ import annotations

import asyncio
import threading

import pytest

from api import task_streams as task_stream_module


class MemoryEventStore:
    def __init__(self) -> None:
        self.rows: dict[str, list[dict]] = {}

    def append(
        self,
        job_id: str,
        seq: int,
        event_type: str,
        phase: str | None,
        message: str,
        data: dict,
        ts: str,
    ) -> None:
        self.rows.setdefault(job_id, []).append(
            {
                "job_id": job_id,
                "seq": seq,
                "type": event_type,
                "phase": phase,
                "message": message,
                "data": data,
                "ts": ts,
            }
        )

    def get_events(self, job_id: str, since_seq: int = 0) -> list[dict]:
        return [row.copy() for row in self.rows.get(job_id, []) if row["seq"] > since_seq]

    def get_last_seq(self, job_id: str) -> int:
        return max((row["seq"] for row in self.rows.get(job_id, [])), default=0)


class BlockingEventStore(MemoryEventStore):
    def __init__(self) -> None:
        super().__init__()
        self.append_started = threading.Event()
        self.release_append = threading.Event()

    def append(self, *args, **kwargs) -> None:
        self.append_started.set()
        if not self.release_append.wait(timeout=2):
            raise TimeoutError("test did not release event persistence")
        super().append(*args, **kwargs)


class FailingEventStore(MemoryEventStore):
    def __init__(self) -> None:
        super().__init__()
        self.fail = True

    def append(self, *args, **kwargs) -> None:
        if self.fail:
            raise OSError("disk unavailable")
        super().append(*args, **kwargs)


@pytest.mark.asyncio
async def test_publish_is_persisted_before_return(monkeypatch):
    store = MemoryEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    manager = task_stream_module.TaskStreamManager()

    event = await manager.publish("job-1", "complete", "finished")

    assert event is not None
    assert store.rows["job-1"][0]["type"] == "complete"


@pytest.mark.asyncio
async def test_publish_is_not_visible_before_persistence_commits(monkeypatch):
    store = BlockingEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    manager = task_stream_module.TaskStreamManager()
    subscriber = await manager.subscribe("job-1")

    publishing = asyncio.create_task(manager.publish("job-1", "complete", "finished"))
    started = await asyncio.to_thread(store.append_started.wait, 1)

    assert started is True
    assert subscriber.empty()
    health_before_commit = await manager.health("job-1")
    assert health_before_commit["last_visible_seq"] == 0

    store.release_append.set()
    event = await publishing

    assert event is not None
    assert subscriber.get_nowait().id == event.id
    assert store.rows["job-1"][0]["seq"] == event.id


@pytest.mark.asyncio
async def test_persistence_failure_does_not_consume_sequence_or_notify(monkeypatch):
    store = FailingEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    manager = task_stream_module.TaskStreamManager()
    subscriber = await manager.subscribe("job-1")

    with pytest.raises(OSError, match="disk unavailable"):
        await manager.publish("job-1", "complete", "not durable")

    assert subscriber.empty()
    assert (await manager.health("job-1"))["last_visible_seq"] == 0

    store.fail = False
    event = await manager.publish("job-1", "complete", "durable")
    assert event is not None
    assert event.id == 1


@pytest.mark.asyncio
async def test_concurrent_publishes_keep_contiguous_sequence(monkeypatch):
    store = MemoryEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    manager = task_stream_module.TaskStreamManager()

    events = await asyncio.gather(
        *(manager.publish("job-1", "agent.chunk", str(index)) for index in range(20))
    )

    assert [event.id for event in events if event is not None] == list(range(1, 21))
    assert [row["seq"] for row in store.rows["job-1"]] == list(range(1, 21))


@pytest.mark.asyncio
async def test_subscriber_overflow_is_reported_and_events_remain_durable(monkeypatch):
    store = MemoryEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    manager = task_stream_module.TaskStreamManager()
    await manager.subscribe("job-1")

    for index in range(201):
        await manager.publish("job-1", "agent.chunk", str(index))

    health = await manager.health("job-1")
    assert health["last_persisted_seq"] == 201
    assert health["last_visible_seq"] == 201
    assert health["subscriber_count"] == 0
    assert health["overflow_count"] == 1
    assert health["last_overflow_at"] is not None


@pytest.mark.asyncio
async def test_new_manager_replays_terminal_event_and_continues_sequence(monkeypatch):
    store = MemoryEventStore()
    monkeypatch.setattr(task_stream_module, "event_store", store)
    first_manager = task_stream_module.TaskStreamManager()
    await first_manager.publish("job-1", "agent.chunk", "part")
    await first_manager.publish("job-1", "complete", "finished")

    restarted_manager = task_stream_module.TaskStreamManager()
    replayed = await restarted_manager.replay_since("job-1", 1)
    next_event = await restarted_manager.publish("job-1", "error", "late failure")

    assert [(event.id, event.type) for event in replayed] == [(2, "complete")]
    assert next_event is not None
    assert next_event.id == 3
