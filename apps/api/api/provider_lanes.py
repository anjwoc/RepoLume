from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass


Heartbeat = Callable[[str, float], Awaitable[None]]


@dataclass(frozen=True)
class LaneSnapshot:
    queued: int
    running: int
    limit: int


class ProviderLaneLease:
    def __init__(self, scheduler: ProviderLaneScheduler, lane: str) -> None:
        self.scheduler = scheduler
        self.lane = lane
        self.released = False

    async def release(self) -> None:
        if self.released:
            return
        self.released = True
        await self.scheduler.release(self.lane)


class ProviderLaneScheduler:
    def __init__(
        self,
        global_limit: int,
        lane_limits: dict[str, int],
        *,
        heartbeat_seconds: float = 15,
    ) -> None:
        if global_limit < 1 or heartbeat_seconds <= 0:
            raise ValueError("Concurrency limits and heartbeat interval must be positive")
        self.global_limit = global_limit
        self.lane_limits = {
            lane: max(1, int(limit)) for lane, limit in lane_limits.items()
        }
        self.heartbeat_seconds = heartbeat_seconds
        self.global_semaphore = asyncio.Semaphore(global_limit)
        self.lane_semaphores: dict[str, asyncio.Semaphore] = {}
        self.queued: dict[str, int] = {}
        self.running: dict[str, int] = {}
        self.state_lock = asyncio.Lock()

    def limit_for(self, lane: str) -> int:
        return self.lane_limits.get(lane, self.global_limit)

    def semaphore_for(self, lane: str) -> asyncio.Semaphore:
        semaphore = self.lane_semaphores.get(lane)
        if semaphore is None:
            semaphore = asyncio.Semaphore(self.limit_for(lane))
            self.lane_semaphores[lane] = semaphore
        return semaphore

    async def wait_for_slot(
        self,
        semaphore: asyncio.Semaphore,
        lane: str,
        stage: str,
        started_at: float,
        heartbeat: Heartbeat | None,
    ) -> None:
        while True:
            try:
                await asyncio.wait_for(
                    semaphore.acquire(),
                    timeout=self.heartbeat_seconds,
                )
                return
            except asyncio.TimeoutError:
                if heartbeat:
                    await heartbeat(stage, time.monotonic() - started_at)

    async def acquire(
        self,
        lane: str,
        heartbeat: Heartbeat | None = None,
    ) -> ProviderLaneLease:
        lane = lane or "default"
        started_at = time.monotonic()
        global_acquired = False
        lane_acquired = False
        async with self.state_lock:
            self.queued[lane] = self.queued.get(lane, 0) + 1
        try:
            await self.wait_for_slot(
                self.semaphore_for(lane),
                lane,
                lane,
                started_at,
                heartbeat,
            )
            lane_acquired = True
            await self.wait_for_slot(
                self.global_semaphore,
                lane,
                "global",
                started_at,
                heartbeat,
            )
            global_acquired = True
            async with self.state_lock:
                self.queued[lane] -= 1
                self.running[lane] = self.running.get(lane, 0) + 1
            return ProviderLaneLease(self, lane)
        except BaseException:
            if lane_acquired:
                self.semaphore_for(lane).release()
            if global_acquired:
                self.global_semaphore.release()
            async with self.state_lock:
                self.queued[lane] = max(0, self.queued.get(lane, 1) - 1)
            raise

    async def release(self, lane: str) -> None:
        self.semaphore_for(lane).release()
        self.global_semaphore.release()
        async with self.state_lock:
            self.running[lane] = max(0, self.running.get(lane, 1) - 1)

    async def snapshot(self) -> dict[str, LaneSnapshot]:
        async with self.state_lock:
            lanes = set(self.lane_limits) | set(self.queued) | set(self.running)
            return {
                lane: LaneSnapshot(
                    queued=self.queued.get(lane, 0),
                    running=self.running.get(lane, 0),
                    limit=self.limit_for(lane),
                )
                for lane in sorted(lanes)
            }


_scheduler: ProviderLaneScheduler | None = None
_scheduler_loop: asyncio.AbstractEventLoop | None = None


def get_provider_lane_scheduler() -> ProviderLaneScheduler:
    global _scheduler, _scheduler_loop
    loop = asyncio.get_running_loop()
    if _scheduler is None or _scheduler_loop is not loop:
        try:
            from api.db.store import settings_store

            config = settings_store.get("cli_config") or {}
        except Exception:
            config = {}
        configured_limits = config.get("provider_concurrency") or {}
        lane_limits = {
            "antigravity": int(
                configured_limits.get(
                    "antigravity",
                    config.get("agy_concurrency", 1),
                )
            ),
            "codex": int(configured_limits.get("codex", 4)),
            "claude": int(configured_limits.get("claude", 4)),
            "openrouter": int(configured_limits.get("openrouter", 8)),
            "openai": int(configured_limits.get("openai", 8)),
            "google": int(configured_limits.get("google", 8)),
        }
        global_limit = int(
            config.get("total_concurrency", config.get("cli_concurrency", 8))
        )
        _scheduler = ProviderLaneScheduler(global_limit, lane_limits)
        _scheduler_loop = loop
    return _scheduler
