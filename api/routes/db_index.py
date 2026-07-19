"""DB Index REST API — status, sync, query."""
import asyncio
import logging

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/db-index/status")
async def db_index_status(project: str = Query(default="default")):
    from cli.db_index.indexer import get_status
    return get_status(project)


@router.post("/api/db-index/sync")
async def db_index_sync(
    source_dir: str = Query(...),
    project: str = Query(default="default"),
    entity_pattern: str = Query(default="*JpaEntity.java"),
    csv_dir: str = Query(default=""),
):
    """Start background indexing. Returns immediately."""
    asyncio.create_task(_run_sync(source_dir, project, entity_pattern, csv_dir or None))
    return {"ok": True, "message": "인덱싱 시작됨", "source_dir": source_dir, "project": project}


@router.get("/api/db-index/sync/stream")
async def db_index_sync_stream(
    source_dir: str = Query(...),
    project: str = Query(default="default"),
    entity_pattern: str = Query(default="*JpaEntity.java"),
    csv_dir: str = Query(default=""),
):
    """SSE: run sync and stream progress events."""
    return StreamingResponse(
        _sync_sse(source_dir, project, entity_pattern, csv_dir or None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/db-index/query")
async def db_index_query(
    q: str = Query(...),
    project: str = Query(default="default"),
    limit: int = Query(default=20),
):
    from cli.db_index.indexer import query_index
    keywords = q.split()
    results = await asyncio.to_thread(query_index, keywords, project, limit)
    return {"count": len(results), "results": results}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _run_sync(source_dir: str, project: str, entity_pattern: str, csv_dir: str | None) -> None:
    from cli.db_index.indexer import build_index
    try:
        await asyncio.to_thread(build_index, source_dir, project, csv_dir, entity_pattern)
    except Exception as e:
        logger.error("[db-index] 백그라운드 인덱싱 실패: %s", e)


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _sync_sse(source_dir: str, project: str, entity_pattern: str, csv_dir: str | None):
    from cli.db_index.indexer import build_index
    import json

    yield _sse("start", json.dumps({"source_dir": source_dir, "project": project}))

    try:
        result = await asyncio.to_thread(build_index, source_dir, project, csv_dir, entity_pattern)
        yield _sse("done", json.dumps(result))
    except Exception as e:
        yield _sse("error", json.dumps({"error": str(e)}))
