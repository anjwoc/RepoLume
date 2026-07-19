from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any


class BackgroundJobRegistry:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._lock = asyncio.Lock()

    async def start(self, job_id: str, coroutine: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        async with self._lock:
            existing = self._tasks.get(job_id)
            if existing and not existing.done():
                coroutine.close()
                raise ValueError(f"Background job already running: {job_id}")
            task = asyncio.create_task(coroutine, name=f"localwiki-job-{job_id}")
            self._tasks[job_id] = task
            task.add_done_callback(
                lambda completed: asyncio.create_task(self._discard(job_id, completed))
            )
            return task

    async def _discard(self, job_id: str, completed: asyncio.Task[Any]) -> None:
        async with self._lock:
            if self._tasks.get(job_id) is completed:
                self._tasks.pop(job_id, None)

    async def cancel(self, job_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(job_id)
            if task is None or task.done():
                return False
            task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True

    async def is_running(self, job_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(job_id)
            return bool(task and not task.done())

    async def cancel_all(self) -> int:
        async with self._lock:
            job_ids = [job_id for job_id, task in self._tasks.items() if not task.done()]
        cancelled = 0
        for job_id in job_ids:
            if await self.cancel(job_id):
                cancelled += 1
        return cancelled


background_jobs = BackgroundJobRegistry()
