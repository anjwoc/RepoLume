from __future__ import annotations

import asyncio
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional, Set

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field


DEFAULT_REPLAY_LIMIT = 500
DEFAULT_STREAM_TTL_SECONDS = 60 * 60
HEARTBEAT_SECONDS = 15


class TaskEvent(BaseModel):
    id: int
    type: str
    stream_id: str
    ts: str
    phase: Optional[str] = None
    message: str = ""
    data: Dict[str, Any] = Field(default_factory=dict)


class TaskEventInput(BaseModel):
    type: str
    phase: Optional[str] = None
    message: str = ""
    data: Dict[str, Any] = Field(default_factory=dict)


class _StreamState:
    def __init__(self, stream_id: str, replay_limit: int) -> None:
        self.stream_id = stream_id
        self.next_id = 1
        self.events: Deque[TaskEvent] = deque(maxlen=replay_limit)
        self.subscribers: Set[asyncio.Queue[TaskEvent]] = set()
        self.updated_at = time.monotonic()


class TaskStreamManager:
    def __init__(
        self,
        replay_limit: int = DEFAULT_REPLAY_LIMIT,
        ttl_seconds: int = DEFAULT_STREAM_TTL_SECONDS,
    ) -> None:
        self._replay_limit = replay_limit
        self._ttl_seconds = ttl_seconds
        self._streams: Dict[str, _StreamState] = {}
        self._lock = asyncio.Lock()

    async def publish(
        self,
        stream_id: Optional[str],
        event_type: str,
        message: str = "",
        phase: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> Optional[TaskEvent]:
        if not stream_id:
            return None

        await self._cleanup()
        async with self._lock:
            state = self._streams.get(stream_id)
            if state is None:
                state = _StreamState(stream_id, self._replay_limit)
                self._streams[stream_id] = state

            event = TaskEvent(
                id=state.next_id,
                type=event_type,
                stream_id=stream_id,
                ts=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                phase=phase,
                message=message,
                data=data or {},
            )
            state.next_id += 1
            state.updated_at = time.monotonic()
            state.events.append(event)

            dead: list[asyncio.Queue[TaskEvent]] = []
            for queue in state.subscribers:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    dead.append(queue)
            for queue in dead:
                state.subscribers.discard(queue)

            return event

    async def replay_since(self, stream_id: str, last_event_id: int) -> list[TaskEvent]:
        async with self._lock:
            state = self._streams.get(stream_id)
            if state is None:
                return []
            state.updated_at = time.monotonic()
            return [event for event in state.events if event.id > last_event_id]

    async def subscribe(self, stream_id: str) -> asyncio.Queue[TaskEvent]:
        async with self._lock:
            state = self._streams.get(stream_id)
            if state is None:
                state = _StreamState(stream_id, self._replay_limit)
                self._streams[stream_id] = state
            state.updated_at = time.monotonic()
            queue: asyncio.Queue[TaskEvent] = asyncio.Queue(maxsize=200)
            state.subscribers.add(queue)
            return queue

    async def unsubscribe(self, stream_id: str, queue: asyncio.Queue[TaskEvent]) -> None:
        async with self._lock:
            state = self._streams.get(stream_id)
            if state is not None:
                state.subscribers.discard(queue)
                state.updated_at = time.monotonic()

    async def _cleanup(self) -> None:
        now = time.monotonic()
        async with self._lock:
            stale = [
                stream_id
                for stream_id, state in self._streams.items()
                if not state.subscribers and now - state.updated_at > self._ttl_seconds
            ]
            for stream_id in stale:
                self._streams.pop(stream_id, None)


task_streams = TaskStreamManager()
router = APIRouter(prefix="/task-streams", tags=["task-streams"])


async def emit_task_event(
    stream_id: Optional[str],
    event_type: str,
    message: str = "",
    phase: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
) -> Optional[TaskEvent]:
    return await task_streams.publish(stream_id, event_type, message, phase, data)


def parse_event_filter(events: Optional[str]) -> Optional[Set[str]]:
    if not events:
        return None
    selected = {part.strip() for part in events.split(",") if part.strip()}
    return selected or None


def parse_last_event_id(value: Optional[str]) -> int:
    if not value:
        return 0
    try:
        return max(0, int(value))
    except ValueError:
        return 0


def should_emit(event: TaskEvent, selected_events: Optional[Set[str]]) -> bool:
    return selected_events is None or event.type in selected_events


def encode_sse(event: TaskEvent, include_id: bool = True) -> str:
    payload = event.model_dump_json()
    prefix = f"id: {event.id}\n" if include_id else ""
    return f"{prefix}event: {event.type}\ndata: {payload}\n\n"


@router.get("/{stream_id}/stream")
async def stream_task_events(
    request: Request,
    stream_id: str,
    last_event_id_header: Optional[str] = Header(None, alias="Last-Event-ID"),
    events: Optional[str] = Query(None),
    poll_ms: int = Query(500, ge=250, le=2000),
) -> StreamingResponse:
    selected_events = parse_event_filter(events)
    last_event_id = parse_last_event_id(last_event_id_header)

    async def event_generator():
        replayed = await task_streams.replay_since(stream_id, last_event_id)
        for event in replayed:
            if should_emit(event, selected_events):
                yield encode_sse(event)

        queue = await task_streams.subscribe(stream_id)
        try:
            while not await request.is_disconnected():
                try:
                    timeout = max(HEARTBEAT_SECONDS, poll_ms / 1000)
                    event = await asyncio.wait_for(queue.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    heartbeat = TaskEvent(
                        id=0,
                        type="heartbeat",
                        stream_id=stream_id,
                        ts=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                        phase="stream",
                        message="stream heartbeat",
                        data={},
                    )
                    if should_emit(heartbeat, selected_events):
                        yield encode_sse(heartbeat, include_id=False)
                    continue

                if should_emit(event, selected_events):
                    yield encode_sse(event)
        finally:
            await task_streams.unsubscribe(stream_id, queue)

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)


@router.post("/{stream_id}/events")
async def post_task_event(stream_id: str, event: TaskEventInput) -> JSONResponse:
    published = await emit_task_event(
        stream_id,
        event.type,
        message=event.message,
        phase=event.phase,
        data=event.data,
    )
    return JSONResponse({"ok": True, "event": published.model_dump() if published else None})
