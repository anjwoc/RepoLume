from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from api.db.generation_jobs import generation_job_store
from api.db.store import job_store
from api.test_scenarios import TestScenarioJobRequest, queue_test_scenario_job


router = APIRouter(prefix="/api/test-scenarios", tags=["test-scenarios"])


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_test_scenario_job(request: TestScenarioJobRequest):
    source_path = Path(request.source_path).expanduser().resolve()
    artifact_root = Path(request.artifact_root).expanduser().resolve()
    if not source_path.is_dir():
        raise HTTPException(status_code=400, detail="source_path must be an existing directory")
    if source_path == artifact_root:
        raise HTTPException(status_code=400, detail="source_path and artifact_root must be different")
    existing = await asyncio.to_thread(job_store.get, request.stream_id)
    if existing:
        raise HTTPException(status_code=409, detail="A job with this stream_id already exists")
    await queue_test_scenario_job(request)
    return {
        "ok": True,
        "status": "queued",
        "job_id": request.stream_id,
        "stream_id": request.stream_id,
    }


@router.get("/jobs/{job_id}")
async def get_test_scenario_job(job_id: str):
    job = await asyncio.to_thread(job_store.get, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Test scenario job not found")
    task = await asyncio.to_thread(generation_job_store.get_task, job_id, "test-scenarios")
    completeness = await asyncio.to_thread(generation_job_store.completeness, job_id)
    manifest = None
    if task:
        try:
            payload = json.loads(task.get("payload_json") or "{}")
            artifact_root = payload.get("request", {}).get("artifact_root")
            if artifact_root:
                manifest_path = Path(artifact_root) / "test-scenarios" / "manifest.json"
                if manifest_path.is_file():
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, TypeError, json.JSONDecodeError):
            manifest = None
    return {"job": job, "task": task, "completeness": completeness, "manifest": manifest}
