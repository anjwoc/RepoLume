"""Graph context endpoints — CodeGraph + Graphify context for wiki page generation."""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class PageContextRequest(BaseModel):
    repo_path: str
    page_title: str
    page_id: Optional[str] = None
    file_paths: List[str] = []


class ArchitectureSummaryRequest(BaseModel):
    repo_path: str


@router.post("/api/graph/page-context")
async def get_page_context(req: PageContextRequest) -> dict[str, Any]:
    """Return CodeGraph/Graphify symbol context for a single wiki page.

    Priority: graphify (best) → codegraph (good) → empty string (caller falls back to file reads).
    """
    try:
        from cli.indexer.graph_context import GraphContext
        from cli.pipeline.structure_planner import WikiPage

        page = WikiPage(
            id=req.page_id or req.page_title,
            title=req.page_title,
            description="",
            importance="medium",
            file_paths=req.file_paths,
        )
        ctx = GraphContext(req.repo_path)
        context = ctx.for_page(page)
        status = ctx.status()
        return {"context": context, "available": bool(context), "status": status}
    except Exception as e:
        logger.warning("graph page-context failed: %s", e)
        return {"context": "", "available": False, "status": {}}


@router.post("/api/graph/architecture")
async def get_architecture_summary(req: ArchitectureSummaryRequest) -> dict[str, Any]:
    """Return Graphify architecture summary for Phase 2b ToC and Phase 4.5 insights."""
    try:
        from cli.indexer.graph_context import GraphContext

        ctx = GraphContext(req.repo_path)
        summary = ctx.architecture_summary()
        return {"summary": summary, "available": bool(summary)}
    except Exception as e:
        logger.warning("graph architecture-summary failed: %s", e)
        return {"summary": "", "available": False}
