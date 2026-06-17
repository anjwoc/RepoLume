"""Agent availability and auth endpoints."""
import logging
from fastapi import APIRouter, HTTPException
from api.routes.models import AuthCodeSubmit
from api.agent_runner import AgentRegistry
from api.auth_pty import check_auth_status, start_auth_session, submit_auth_code

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/agent/list")
async def agent_list():
    registry = AgentRegistry()
    return {"agents": registry.status(), "available": registry.available()}


@router.get("/agent/check/{agent_name}")
async def agent_check(agent_name: str):
    registry = AgentRegistry()
    try:
        runner = registry.get(agent_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "agent": agent_name,
        "available": runner.available(),
        "default_model": runner.default_model,
    }


@router.get("/agent/auth/status")
async def agent_auth_status():
    return {"authenticated": await check_auth_status()}


@router.post("/agent/auth/start")
async def agent_auth_start():
    result = await start_auth_session()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result


@router.post("/agent/auth/submit")
async def agent_auth_submit(data: AuthCodeSubmit):
    result = await submit_auth_code(data.code)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result
