"""Admin pipeline tracking API.

Endpoints:
  GET  /api/admin/runs                     — 최근 파이프라인 실행 목록
  GET  /api/admin/runs/{job_id}            — 단일 실행 상세 (job + events)
  GET  /api/admin/runs/{job_id}/timeline   — 이벤트 타임라인 (since_seq 지원)
  GET  /api/admin/runs/{job_id}/stream     — 진행 중 실행 SSE 재구독
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.db.store import event_store, job_store
from api.events import EventType

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Response models ─────────────────────────────────────────────────────────

class RunSummary(BaseModel):
    job_id: str
    project_id: Optional[str] = None
    status: str
    current_phase: Optional[str] = None
    page_total: int = 0
    page_done: int = 0
    page_failed: int = 0
    duration_ms: Optional[int] = None
    started_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None
    mcp_providers: list[str] = []
    entities: dict[str, int] = {}


class RunDetail(RunSummary):
    events: list[dict[str, Any]] = []


class TimelineResponse(BaseModel):
    job_id: str
    events: list[dict[str, Any]]
    has_more: bool = False


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _enrich_run(job: dict, events: list[dict] | None = None) -> RunSummary:
    """Annotate a raw job dict with mcp_providers and entities from events."""
    mcp_providers: list[str] = []
    entities: dict[str, int] = {}

    if events is None:
        events = event_store.get_events(job["id"])

    for ev in events:
        if ev["type"] == EventType.MCP_RESPONDED:
            provider = (ev.get("data") or {}).get("provider")
            if provider and provider not in mcp_providers:
                mcp_providers.append(provider)
        if ev["type"] == EventType.ENTITY_EXTRACTED:
            data = ev.get("data") or {}
            entities = {k: v for k, v in data.items() if isinstance(v, int)}

    return RunSummary(
        job_id=job["id"],
        project_id=job.get("project_id"),
        status=job.get("status", "unknown"),
        current_phase=job.get("current_phase"),
        page_total=job.get("page_total") or 0,
        page_done=job.get("page_done") or 0,
        page_failed=job.get("page_failed") or 0,
        duration_ms=job.get("duration_ms"),
        started_at=job.get("started_at", ""),
        completed_at=job.get("completed_at"),
        error=job.get("error"),
        mcp_providers=mcp_providers,
        entities=entities,
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/api/admin/runs")
async def list_runs(
    limit: int = Query(default=30, ge=1, le=200),
    project_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """Return recent pipeline runs with aggregated MCP and entity stats."""
    jobs = await asyncio.to_thread(job_store.list, project_id, limit)
    runs = []
    for job in jobs:
        events = await asyncio.to_thread(event_store.get_events, job["id"])
        runs.append(_enrich_run(job, events).model_dump())
    return {"runs": runs, "total": len(runs)}


@router.get("/api/admin/runs/{job_id}")
async def get_run(job_id: str) -> RunDetail:
    """Return full job detail including all events."""
    job = await asyncio.to_thread(job_store.get, job_id)
    if job is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")

    events = await asyncio.to_thread(event_store.get_events, job_id)
    summary = _enrich_run(job, events)
    return RunDetail(**summary.model_dump(), events=events)


@router.get("/api/admin/runs/{job_id}/timeline")
async def get_timeline(
    job_id: str,
    since_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
) -> TimelineResponse:
    """Return paginated event timeline for a run."""
    job = await asyncio.to_thread(job_store.get, job_id)
    if job is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")

    events = await asyncio.to_thread(event_store.get_events, job_id, since_seq)
    page = events[:limit]
    return TimelineResponse(
        job_id=job_id,
        events=page,
        has_more=len(events) > limit,
    )


@router.get("/api/admin/runs/{job_id}/stream")
async def stream_run(job_id: str) -> StreamingResponse:
    """
    SSE re-subscription for an in-progress run.

    Replays all stored events then tails the live TaskStreamManager channel.
    On job completion (phase.completed for 'save' phase or status != 'running'),
    emits a terminal 'run.ended' event and closes.
    """
    from api.task_streams import task_stream_manager

    async def _generate():
        # 1. Replay persisted events
        stored = await asyncio.to_thread(event_store.get_events, job_id, 0)
        for ev in stored:
            yield f"id: {ev['seq']}\ndata: {json.dumps(ev)}\n\n"

        # 2. If job already finished, close immediately
        job = await asyncio.to_thread(job_store.get, job_id)
        if job and job.get("status") not in ("running", "pending"):
            yield f"data: {json.dumps({'type': 'run.ended', 'job_id': job_id, 'status': job['status']})}\n\n"
            return

        # 3. Tail live stream
        queue = await task_stream_manager.subscribe(job_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    payload = event if isinstance(event, dict) else event.__dict__
                    yield f"data: {json.dumps(payload)}\n\n"

                    ev_type = payload.get("type", "")
                    if ev_type in (EventType.PIPELINE_COMPLETED, EventType.PIPELINE_FAILED):
                        yield f"data: {json.dumps({'type': 'run.ended', 'job_id': job_id})}\n\n"
                        break
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await task_stream_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
