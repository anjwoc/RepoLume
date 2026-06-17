"""Language config, auth, model config, health, and utility endpoints."""
import asyncio
import logging
from datetime import datetime
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from typing import Any, Optional
import httpx
from pydantic import BaseModel

from api.config import configs, WIKI_AUTH_MODE, WIKI_AUTH_CODE
from api.routes.models import AuthorizationConfig, Model, ModelConfig, Provider
from api.db.store import settings_store

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Generic key-value settings (SQLite) ──────────────────────────────────────

class SettingsBody(BaseModel):
    value: Any


@router.get("/api/settings/{key}")
async def get_setting(key: str):
    value = settings_store.get(key)
    if value is None:
        return {"key": key, "value": None, "found": False}
    return {"key": key, "value": value, "found": True}


@router.put("/api/settings/{key}")
async def put_setting(key: str, body: SettingsBody):
    settings_store.set(key, body.value)
    if key == "mcp_settings" and isinstance(body.value, dict):
        try:
            yaml_cfg = _mcp_settings_to_yaml(body.value)
            await asyncio.to_thread(_write_mcp_yaml, yaml_cfg)
        except Exception as e:
            logger.warning("mcp yaml sync failed: %s", e)
    return {"ok": True, "key": key}


def _mcp_settings_to_yaml(settings: dict) -> dict:
    """Convert MCPSettings (SQLite JSON) to mcp-config.yaml dict."""
    providers = settings.get("providers", [])
    cfg: dict = {}

    DB_TYPES = {"postgresql", "mysql", "mssql", "oracle", "mariadb", "mongodb"}
    databases: dict = {}
    for p in providers:
        ptype = p.get("type", "")
        if ptype not in DB_TYPES:
            continue
        db_url = p.get("config", {}).get("dbUrl", "")
        if db_url:
            databases[ptype] = {
                "enabled": p.get("isEnabled", False),
                "connection_string": db_url,
                "display_name": p.get("name", ptype),
            }
    if databases:
        cfg["databases"] = databases

    for p in providers:
        if p.get("type") == "github":
            c = p.get("config", {})
            entry: dict = {
                "enabled": p.get("isEnabled", False),
                "mode": "local",
                "local": {"token": c.get("apiToken", "")},
                "owner": "",
                "repo": "",
            }
            if c.get("apiUrl"):
                entry["base_url"] = c["apiUrl"]
            cfg["github"] = entry

    jira = next((p for p in providers if p.get("type") == "jira"), None)
    conf = next((p for p in providers if p.get("type") == "confluence"), None)
    if jira or conf:
        cfg["atlassian"] = {
            "enabled": bool((jira or {}).get("isEnabled")) or bool((conf or {}).get("isEnabled")),
            "mode": "datacenter",
            "datacenter": {
                "base_url": (jira or {}).get("config", {}).get("apiUrl", ""),
                "confluence_url": (conf or {}).get("config", {}).get("apiUrl", ""),
                "pat": "",
            },
            "jira_project": "",
            "space_key": "",
        }

    custom: dict = {}
    for p in providers:
        if p.get("edition") == "custom" and p.get("customCommand"):
            custom[p["id"]] = {
                "command": p["customCommand"],
                "enabled": p.get("isEnabled", False),
            }
    if custom:
        cfg["custom_mcps"] = custom

    return cfg


def _write_mcp_yaml(cfg: dict) -> None:
    """Write cfg to ~/.localwiki/mcp-config.yaml."""
    import yaml
    from pathlib import Path
    path = Path.home() / ".localwiki" / "mcp-config.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)


@router.get("/lang/config")
async def get_lang_config():
    return configs["lang_config"]


@router.get("/auth/status")
async def get_auth_status():
    return {"auth_required": WIKI_AUTH_MODE}


@router.post("/auth/validate")
async def validate_auth_code(request: AuthorizationConfig):
    return {"success": WIKI_AUTH_CODE == request.code}


@router.get("/models/config", response_model=ModelConfig)
async def get_model_config():
    try:
        providers = []
        default_provider = configs.get("default_provider", "google")
        for provider_id, provider_config in configs["providers"].items():
            models = [Model(id=mid, name=mid) for mid in provider_config["models"]]
            providers.append(Provider(
                id=provider_id,
                name=provider_id.capitalize(),
                supportsCustomModel=provider_config.get("supportsCustomModel", False),
                models=models,
            ))
        return ModelConfig(providers=providers, defaultProvider=default_provider)
    except Exception as e:
        logger.error(f"Error building model config: {e}")
        return ModelConfig(
            providers=[Provider(
                id="google", name="Google", supportsCustomModel=True,
                models=[Model(id="gemini-2.5-flash", name="Gemini 2.5 Flash")],
            )],
            defaultProvider="google",
        )


@router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat(), "service": "localwiki-api"}


@router.get("/check-connection")
async def check_connection(
    mode: str = Query("cli"),
    url: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    api_key: Optional[str] = Query(None),
):
    if mode == "cli":
        if not url:
            return JSONResponse({"ok": False, "message": "URL이 필요합니다."})
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{url.rstrip('/')}/health")
                if resp.status_code < 500:
                    return {"ok": True, "message": f"✅ litellm 서버 연결 성공! ({url})"}
                return {"ok": False, "message": f"서버 응답 오류: HTTP {resp.status_code}"}
        except httpx.ConnectError:
            return JSONResponse({"ok": False, "message": f"❌ 연결 실패: {url} 에 서버가 없습니다."})
        except Exception as e:
            return JSONResponse({"ok": False, "message": f"❌ 연결 오류: {str(e)}"})
    else:
        if not api_key or len(api_key.strip()) < 10:
            return JSONResponse({"ok": False, "message": "API 키가 너무 짧습니다."})
        return {"ok": True, "message": "✅ API 키가 등록되었습니다. 생성 시 실제 검증됩니다."}
