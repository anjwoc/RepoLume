import os
import yaml
import socket
import httpx
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

router = APIRouter(prefix="/mcp", tags=["mcp"])

_DEFAULT_CONFIG = Path.home() / ".localwiki" / "mcp-config.yaml"

class MCPConfig(BaseModel):
    apiToken: Optional[str] = None
    apiUrl: Optional[str] = None
    workspace: Optional[str] = None
    repository: Optional[str] = None
    database: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    options: Optional[Dict[str, Any]] = None

class MCPProvider(BaseModel):
    id: str
    type: str
    name: str
    description: str
    icon: str
    category: str
    isEnabled: bool
    isConnected: bool
    config: MCPConfig

class MCPSettings(BaseModel):
    crossCheckEnabled: bool
    autoSync: bool
    syncInterval: int
    providers: List[MCPProvider]

def _load_yaml() -> dict:
    if not _DEFAULT_CONFIG.is_file():
        return {}
    try:
        with open(_DEFAULT_CONFIG, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}

def _save_yaml(data: dict):
    os.makedirs(_DEFAULT_CONFIG.parent, exist_ok=True)
    with open(_DEFAULT_CONFIG, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, sort_keys=False)

@router.get("/config", response_model=MCPSettings)
async def get_mcp_config():
    data = _load_yaml()
    
    # We will just return the settings with matching values from the YAML
    # First, let's create a default MCPSettings object
    from api.server import logger
    
    # Base defaults matching the frontend
    providers = []
    
    # 1. GitHub
    gh = data.get("github", {})
    providers.append(MCPProvider(
        id="github", type="github", name="GitHub", description="GitHub 저장소 연동",
        icon="github", category="vcs", isEnabled=gh.get("enabled", False), isConnected=False,
        config=MCPConfig(
            apiToken=gh.get("local", {}).get("token", ""),
            repository=f"{gh.get('owner', '')}/{gh.get('repo', '')}" if gh.get("owner") else ""
        )
    ))
    
    # 2. Atlassian
    atl = data.get("atlassian", {})
    atl_mode = atl.get("mode", "datacenter")
    atl_dc = atl.get("datacenter", {})
    providers.append(MCPProvider(
        id="jira", type="jira", name="Jira / Confluence", description="Atlassian 연동",
        icon="jira", category="project", isEnabled=atl.get("enabled", False), isConnected=False,
        config=MCPConfig(
            apiUrl=atl_dc.get("base_url", ""),
            apiToken=atl_dc.get("pat", ""),
            options={"mode": atl_mode, "confluence_url": atl_dc.get("confluence_url", "")}
        )
    ))
    
    # 3. Databases
    db_data = data.get("databases", {})
    for db_type in ["postgresql", "mysql", "mongodb"]:
        db_info = db_data.get(db_type, {})
        conn_str = db_info.get("connection_string", "")
        # Parse connection string if available
        host, port, db, user = "", None, "", ""
        if conn_str:
            try:
                import re
                m = re.search(r"://([^:]+):[^@]*@([^:]+):(\d+)/(.+)", conn_str)
                if m:
                    user, host, port, db = m.group(1), m.group(2), int(m.group(3)), m.group(4)
            except:
                pass
                
        providers.append(MCPProvider(
            id=f"dbhub-{db_type}", type=db_type, name=f"{db_type.capitalize()} (DBHub)",
            description=f"DBHub MCP를 통한 {db_type.capitalize()} 데이터베이스 연동", icon="database", category="database",
            isEnabled=db_info.get("enabled", False), isConnected=False,
            config=MCPConfig(host=host, port=port, database=db, username=user, options={"connection_string": conn_str})
        ))
        
    return MCPSettings(
        crossCheckEnabled=data.get("crossCheckEnabled", True),
        autoSync=data.get("autoSync", False),
        syncInterval=data.get("syncInterval", 30),
        providers=providers
    )

@router.post("/config")
async def save_mcp_config(settings: MCPSettings):
    data = _load_yaml()
    
    data["crossCheckEnabled"] = settings.crossCheckEnabled
    data["autoSync"] = settings.autoSync
    data["syncInterval"] = settings.syncInterval
    
    for p in settings.providers:
        if p.type == "github":
            owner, repo = "", ""
            if p.config.repository and "/" in p.config.repository:
                owner, repo = p.config.repository.split("/", 1)
            
            data["github"] = {
                "enabled": p.isEnabled,
                "mode": "local",
                "local": {"token": p.config.apiToken or ""},
                "owner": owner,
                "repo": repo,
                "toolsets": ["repos", "issues", "pull_requests"]
            }
        elif p.type == "jira":
            mode = (p.config.options or {}).get("mode", "datacenter")
            conf_url = (p.config.options or {}).get("confluence_url", "")
            data["atlassian"] = {
                "enabled": p.isEnabled,
                "mode": mode,
                "datacenter": {
                    "base_url": p.config.apiUrl or "",
                    "confluence_url": conf_url or p.config.apiUrl or "",
                    "pat": p.config.apiToken or ""
                },
                "cloud": {
                    "mcp_url": "https://mcp.atlassian.com/v1/sse"
                }
            }
        elif p.type in ["postgresql", "mysql", "mongodb"]:
            if "databases" not in data:
                data["databases"] = {}
                
            # Construct connection string if it's provided in fields
            conn_str = (p.config.options or {}).get("connection_string", "")
            if not conn_str and p.config.host:
                port = p.config.port or (5432 if p.type == "postgresql" else 3306)
                conn_str = f"{p.type}://{p.config.username or 'user'}:password@{p.config.host}:{port}/{p.config.database or 'mydb'}"
                
            data["databases"][p.type] = {
                "enabled": p.isEnabled,
                "connection_string": conn_str,
                "display_name": p.name
            }
            
    _save_yaml(data)
    return {"success": True}

@router.post("/test/{provider_type}")
async def test_mcp_connection(provider_type: str, config: MCPConfig):
    if provider_type == "github":
        if not config.apiToken:
            raise HTTPException(status_code=400, detail="Token is required for GitHub")
        async with httpx.AsyncClient() as client:
            resp = await client.get("https://api.github.com/user", headers={"Authorization": f"token {config.apiToken}"})
            if resp.status_code == 200:
                return {"success": True, "message": "GitHub connection successful"}
            raise HTTPException(status_code=400, detail=f"GitHub connection failed: {resp.status_code}")
            
    elif provider_type == "jira":
        if not config.apiUrl or not config.apiToken:
            raise HTTPException(status_code=400, detail="URL and PAT are required for Atlassian DataCenter")
        
        # Test Jira
        jira_url = config.apiUrl.rstrip('/') + "/rest/api/2/serverInfo"
        async with httpx.AsyncClient() as client:
            resp = await client.get(jira_url, headers={"Authorization": f"Bearer {config.apiToken}"})
            if resp.status_code in (200, 403): # 403 means token is valid but needs specific scope, still "connected" to network
                return {"success": True, "message": "Atlassian connection successful"}
            raise HTTPException(status_code=400, detail=f"Atlassian connection failed: {resp.status_code}")
            
    elif provider_type in ["postgresql", "mysql", "mongodb"]:
        host = config.host
        port = config.port
        if not host:
            # Try to parse from connection string
            conn_str = (config.options or {}).get("connection_string", "")
            import re
            m = re.search(r"@([^:]+):(\d+)", conn_str)
            if m:
                host, port = m.group(1), int(m.group(2))
        
        if not host or not port:
            raise HTTPException(status_code=400, detail="Host and Port are required for DB connection test")
            
        try:
            with socket.create_connection((host, port), timeout=5):
                return {"success": True, "message": f"Successfully connected to {host}:{port}"}
        except OSError as e:
            raise HTTPException(status_code=400, detail=f"Failed to connect to {host}:{port}: {e}")
            
    raise HTTPException(status_code=400, detail=f"Unsupported provider type: {provider_type}")
