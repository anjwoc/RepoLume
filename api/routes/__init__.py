"""Combines all route modules into a single router for inclusion in server.py."""
from fastapi import APIRouter

from api.routes.agent import router as agent_router
from api.routes.business import router as business_router
from api.routes.config import router as config_router
from api.routes.diagram import router as diagram_router
from api.routes.export import router as export_router
from api.routes.fs import router as fs_router
from api.routes.jobs import router as jobs_router
from api.routes.wiki import router as wiki_router
from api.routes.benchmark import router as benchmark_router
from api.routes.admin import router as admin_router
from api.routes.code import router as code_router
from api.routes.graph import router as graph_router
from api.routes.mcp import router as mcp_router

router = APIRouter()
router.include_router(config_router)
router.include_router(agent_router)
router.include_router(wiki_router)
router.include_router(export_router)
router.include_router(fs_router)
router.include_router(business_router)
router.include_router(diagram_router)
router.include_router(jobs_router)
router.include_router(benchmark_router)
router.include_router(admin_router)
router.include_router(code_router)
router.include_router(graph_router)
router.include_router(mcp_router)

__all__ = ["router"]
