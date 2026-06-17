"""FastAPI application — init, CORS, and router registration only."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.logging_config import setup_logging
from api.db import init_db
from api.task_streams import router as task_stream_router
from api.chat import chat_completions_stream
from api.routes import router as api_router

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logger.info("SQLite DB initialized")
    yield


app = FastAPI(
    title="LocalWiki API",
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
    return {"message": "Welcome to LocalWiki API", "version": "2.0.0", "endpoints": endpoints}

