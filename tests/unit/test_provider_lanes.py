from __future__ import annotations

import asyncio

import pytest

from api.provider_lanes import ProviderLaneScheduler


@pytest.mark.asyncio
async def test_provider_lane_caps_each_provider_and_global_concurrency():
    scheduler = ProviderLaneScheduler(2, {"agy": 1, "codex": 2}, heartbeat_seconds=1)
    entered: list[str] = []
    release = asyncio.Event()

    async def run(lane: str):
        lease = await scheduler.acquire(lane)
        entered.append(lane)
        await release.wait()
        await lease.release()

    tasks = [
        asyncio.create_task(run("agy")),
        asyncio.create_task(run("agy")),
        asyncio.create_task(run("codex")),
    ]
    await asyncio.sleep(0.02)
    snapshot = await scheduler.snapshot()

    assert entered.count("agy") == 1
    assert len(entered) == 2
    assert snapshot["agy"].running == 1
    assert snapshot["agy"].queued == 1

    release.set()
    await asyncio.gather(*tasks)
    final = await scheduler.snapshot()
    assert all(state.running == 0 and state.queued == 0 for state in final.values())


@pytest.mark.asyncio
async def test_waiting_for_a_lane_emits_heartbeats_until_admitted():
    scheduler = ProviderLaneScheduler(1, {"codex": 1}, heartbeat_seconds=0.01)
    first = await scheduler.acquire("codex")
    heartbeats: list[tuple[str, float]] = []

    async def heartbeat(stage: str, waited: float) -> None:
        heartbeats.append((stage, waited))

    waiting = asyncio.create_task(scheduler.acquire("codex", heartbeat))
    await asyncio.sleep(0.035)
    await first.release()
    second = await waiting
    await second.release()

    assert heartbeats
    assert all(stage == "codex" for stage, _ in heartbeats)


@pytest.mark.asyncio
async def test_cancelled_waiter_releases_any_partially_acquired_capacity():
    scheduler = ProviderLaneScheduler(2, {"agy": 1}, heartbeat_seconds=1)
    first = await scheduler.acquire("agy")
    waiting = asyncio.create_task(scheduler.acquire("agy"))
    await asyncio.sleep(0.01)
    waiting.cancel()

    with pytest.raises(asyncio.CancelledError):
        await waiting
    await first.release()
    replacement = await asyncio.wait_for(scheduler.acquire("agy"), timeout=0.1)
    await replacement.release()

    snapshot = await scheduler.snapshot()
    assert snapshot["agy"].queued == 0
    assert snapshot["agy"].running == 0
