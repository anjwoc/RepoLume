"""FastAPI application — init, CORS, and router registration only."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.logging_config import setup_logging
from api.background_jobs import background_jobs
from api.db import init_db
from api.db.generation_jobs import generation_job_store
from api.db.store import job_store
from api.task_streams import emit_task_event, router as task_stream_router
from api.chat import chat_completions_stream
from api.chat.handler import resume_requeued_generation
from api.test_scenarios import resume_requeued_test_scenario_job
from api.process_supervisor import terminate_process_tree_if_matches
from api.routes import router as api_router

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    active_attempts = await asyncio.to_thread(generation_job_store.list_active_attempts)
    for attempt in active_attempts:
        terminated = await asyncio.to_thread(
            terminate_process_tree_if_matches,
            attempt.get("pid") or 0,
            attempt.get("process_group_id"),
            attempt.get("process_fingerprint"),
        )
        logger.info(
            "Restart process cleanup attempt=%s terminated=%s",
            attempt["attempt_id"],
            terminated,
        )
    orphaned = generation_job_store.reconcile_orphaned_attempts()
    for attempt in orphaned:
        if attempt["requeued"]:
            if attempt.get("kind") == "test_scenarios":
                await resume_requeued_test_scenario_job(attempt)
            else:
                await resume_requeued_generation(attempt)
        else:
            message = "Execution could not be safely resumed after service restart"
            await asyncio.to_thread(job_store.fail, attempt["job_id"], message)
            await emit_task_event(
                attempt["job_id"],
                "error",
                message,
                phase="recovery",
                data={"task_id": attempt["task_id"]},
            )
    logger.info("SQLite DB initialized")
    try:
        yield
    finally:
        await background_jobs.cancel_all()


app = FastAPI(
    title="RepoLume API",
    description="API for local wiki generation and streaming",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(task_stream_router)
app.include_router(api_router)
app.add_api_route("/chat/completions/stream", chat_completions_stream, methods=["POST"])


@app.get("/")
async def root():
    endpoints: dict = {}
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            if route.path in ["/openapi.json", "/docs", "/redoc", "/favicon.ico"]:
                continue
            path_parts = route.path.strip("/").split("/")
            group = path_parts[0].capitalize() if path_parts[0] else "Root"
            for method in list(route.methods - {"HEAD", "OPTIONS"}):
                endpoints.setdefault(group, []).append(f"{method} {route.path}")
    for group in endpoints:
        endpoints[group].sort()
    return {"message": "Welcome to RepoLume API", "version": "2.0.0", "endpoints": endpoints}
