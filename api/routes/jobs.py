"""Job history and event replay endpoints."""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.db.store import event_store, job_store, project_store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/jobs")
async def list_jobs(
    project_id: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=200),
    status_filter: Optional[str] = Query(None),
):
    try:
        return await asyncio.to_thread(job_store.list, project_id, limit, status_filter)
    except Exception as e:
        logger.error(f"list_jobs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = await asyncio.to_thread(job_store.get, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return job


@router.get("/api/jobs/{job_id}/events")
async def get_job_events(
    job_id: str,
    since_seq: int = Query(0, ge=0),
):
    job = await asyncio.to_thread(job_store.get, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    events = await asyncio.to_thread(event_store.get_events, job_id, since_seq)
    return {"job_id": job_id, "events": events, "count": len(events)}


@router.get("/api/projects")
async def list_projects():
    try:
        return await asyncio.to_thread(project_store.list_all)
    except Exception as e:
        logger.error(f"list_projects error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    project = await asyncio.to_thread(project_store.get, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project


@router.get("/api/projects/{project_id}/jobs")
async def get_project_jobs(
    project_id: str,
    limit: int = Query(20, ge=1, le=200),
):
    project = await asyncio.to_thread(project_store.get, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return await asyncio.to_thread(job_store.list, project_id, limit)
