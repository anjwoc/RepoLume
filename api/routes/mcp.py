"""MCP connectivity test + cross-check collect endpoints."""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from api.events import EventType, PhaseType
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Request / Response ───────────────────────────────────────────────────────

class MCPTestRequest(BaseModel):
    provider_type: str          # "github" | "jira" | "confluence" | "postgresql" | "mysql" | "mongodb"
    config: dict[str, Any] = {}


class MCPTestResult(BaseModel):
    ok: bool
    message: str
    details: dict[str, Any] = {}


class MCPCollectRequest(BaseModel):
    project_path: str
    project_id: Optional[str] = None   # "{owner}:{repo}:{language}" for per-project config
    entities: dict[str, Any] = {}      # CodeEntities dict
    topic_hint: str = ""
    stream_id: Optional[str] = None
    file_contents: Optional[list[str]] = None  # sample source files for DB type detection


class MCPCollectResult(BaseModel):
    ok: bool
    contexts: dict[str, str] = {}   # {provider_label: context_text}
    skipped: list[str] = []


class McpClientState(BaseModel):
    enabled: bool = False
    available: bool = False


class McpDbState(McpClientState):
    schema: str = ""          # Full DB schema text (### TABLE headings + DDL)
    table_names: list[str] = []


class McpGithubState(McpClientState):
    owner: str = ""
    repo: str = ""


class McpInitResult(BaseModel):
    """Pre-flight MCP state returned before wiki generation starts."""
    ok: bool = True
    db: McpDbState = McpDbState()
    github: McpGithubState = McpGithubState()
    atlassian: McpClientState = McpClientState()
    any_available: bool = False
    validated_repos: list[dict] = []  # [{path, owner, repo, web_url, valid}]


class McpInitRequest(BaseModel):
    project_path: str = ""
    project_id: Optional[str] = None  # "{owner}:{repo}:{language}" for per-project config


# ─── MCP cross-check collect endpoint ────────────────────────────────────────

@router.post("/api/mcp/collect")
async def collect_mcp_context(request: MCPCollectRequest) -> MCPCollectResult:
    """
    Phase 3 of the wiki generation pipeline.

    Uses code-extracted entities (tables, SPs, topics, services) to
    reverse-query connected MCPs for real schema/issue/doc context.
    Emits mcp.queried / mcp.responded / mcp.skipped events per provider.
    """
    sid = request.stream_id
    await emit_task_event(sid, EventType.PHASE_STARTED,
                          phase=PhaseType.MCP,
                          message="🔌 MCP 크로스체크 시작...")

    try:
        result = await asyncio.to_thread(_run_cross_check, request)
        for label in result.skipped:
            await emit_task_event(sid, EventType.MCP_SKIPPED,
                                  phase=PhaseType.MCP,
                                  data={"provider": label, "reason": "error or unavailable"})
        for label, ctx_text in result.contexts.items():
            await emit_task_event(sid, EventType.MCP_RESPONDED,
                                  phase=PhaseType.MCP,
                                  data={"provider": label,
                                        "context_bytes": len(ctx_text.encode())})

        active = len(result.contexts)
        skipped = len(result.skipped)
        await emit_task_event(sid, EventType.PHASE_COMPLETED,
                              phase=PhaseType.MCP,
                              message=f"✅ MCP 크로스체크 완료 — {active}개 성공, {skipped}개 제외")
        return result
    except Exception as e:
        logger.error("MCP collect error: %s", e)
        await emit_task_event(sid, EventType.PHASE_FAILED,
                              phase=PhaseType.MCP,
                              message=f"❌ MCP 크로스체크 실패: {e}")
        return MCPCollectResult(ok=False)


def _run_cross_check(request: MCPCollectRequest) -> MCPCollectResult:
    """Synchronous MCPManager call — runs in thread pool."""
    try:
        from cli.mcp.manager import MCPManager
        if request.project_id:
            mgr = MCPManager.for_project(request.project_id)
        else:
            mgr = MCPManager.from_config()

        # DBGraph: if fresh index exists, disable live DB clients and inject indexed context
        _dbindex_ctx: str = ""
        try:
            from cli.db_index.indexer import is_fresh as _fresh, get_table_context as _tbl_ctx
            _db_tables: list[str] = (request.entities or {}).get("db_tables", [])
            if request.project_id and _db_tables and _fresh(request.project_id):
                # Disable DB clients on this local mgr instance (safe — per-request object)
                for _c in mgr._db_clients:
                    _c._config.enabled = False
                _dbindex_ctx = _tbl_ctx(_db_tables, request.project_id)
                if _dbindex_ctx:
                    logger.info(
                        "MCP collect: DB context from db-index (%d tables, %d chars) — live MCP 건너뜀",
                        len(_db_tables), len(_dbindex_ctx),
                    )
        except Exception as _e:
            logger.debug("db-index collect fallback (live MCP): %s", _e)

        contexts = mgr.collect_cross_check_context(
            entities=request.entities,
            topic_hint=request.topic_hint,
            code_snippets=request.file_contents,
        )

        if _dbindex_ctx:
            contexts["DB (db-index)"] = _dbindex_ctx

        return MCPCollectResult(ok=True, contexts=contexts)
    except Exception as e:
        logger.error("_run_cross_check error: %s", e)
        return MCPCollectResult(ok=False, skipped=[str(e)])


# ─── MCP pre-flight init endpoint ───────────────────────────────────────────

@router.post("/api/mcp/init")
async def init_mcp(request: McpInitRequest) -> McpInitResult:
    """
    Phase 0 of the wiki generation pipeline.

    Checks which MCPs are configured AND reachable, pre-fetches DB schema,
    and detects the GitHub owner/repo from the git remote.

    Called once before page generation starts; results are cached in the
    frontend for the entire wiki run so no per-page MCP calls are needed.
    """
    try:
        result = await asyncio.to_thread(_run_mcp_init, request.project_path, request.project_id)
        return result
    except Exception as e:
        logger.error("MCP init error: %s", e)
        return McpInitResult(ok=False)


def _run_mcp_init(project_path: str, project_id: str | None = None) -> McpInitResult:
    """Synchronous MCP pre-initialization — runs in thread pool."""
    try:
        from cli.mcp.manager import MCPManager
        from cli.mcp.github_mcp import detect_github_remote

        mgr = MCPManager.for_project(project_id) if project_id else MCPManager.from_config()
        status = mgr.status()

        result = McpInitResult()

        # ── DB ────────────────────────────────────────────────────────────────
        db_enabled = any(v for k, v in status.items() if k.startswith("db_"))

        # DBGraph index: skip live MCP if index is fresh
        _dbindex_used = False
        try:
            from cli.db_index.indexer import (
                is_fresh as _dbindex_fresh,
                build_schema_text as _build_schema_text,
            )
            import re as _re
            if project_id and _dbindex_fresh(project_id):
                _schema = _build_schema_text(project_id)
                if _schema:
                    result.db.enabled = True
                    result.db.available = True
                    result.db.schema = _schema
                    result.db.table_names = _re.findall(r"^###\s+(\S+)", _schema, _re.MULTILINE)
                    logger.info(
                        "MCP init: DB schema from db-index (%d tables, %d chars) — MCP 건너뜀",
                        len(result.db.table_names), len(result.db.schema),
                    )
                    _dbindex_used = True
                    db_enabled = False  # skip live MCP below
        except Exception as _e:
            logger.debug("db-index 로드 실패 (live MCP fallback): %s", _e)

        if db_enabled:
            for db_client in mgr._db_clients:
                if not db_client._config.enabled or not db_client.available:
                    continue
                result.db.enabled = True
                result.db.available = True
                try:
                    ctx = db_client.get_schema_context()
                    if ctx and ctx.content:
                        result.db.schema = ctx.content
                        import re as _re
                        result.db.table_names = _re.findall(
                            r"^###\s+(\S+)", ctx.content, _re.MULTILINE
                        )
                        logger.info(
                            "MCP init: DB schema fetched (%d tables, %d chars)",
                            len(result.db.table_names), len(result.db.schema),
                        )
                except Exception as e:
                    err_str = str(e)
                    if "nodename nor servname" in err_str or "Name or service not known" in err_str or "getaddrinfo" in err_str:
                        logger.warning(
                            "MCP init: DB schema fetch failed — DNS 해석 불가 (%s). VPN 연결 여부 확인.",
                            db_client._config.display_name,
                        )
                    else:
                        logger.warning("MCP init: DB schema fetch failed: %s", e)
                break  # one DB client is enough

        # ── GitHub ────────────────────────────────────────────────────────────
        gh_enabled = status.get("github", False)
        if gh_enabled and mgr._github_client:
            result.github.enabled = True
            result.github.available = True
            owner = mgr._github_client._config.owner
            repo = mgr._github_client._config.repo
            if not owner or not repo:
                detected = detect_github_remote(project_path) if project_path else None
                if detected:
                    owner, repo = detected
            result.github.owner = owner or ""
            result.github.repo = repo or ""
            logger.info("MCP init: GitHub %s/%s", owner, repo)

        # ── Validate git sub-repos ─────────────────────────────────────────
        if project_path:
            raw_roots = mgr.scan_git_roots(project_path)
            result.validated_repos = mgr.validate_git_roots(raw_roots)
            invalid = [r["repo"] for r in result.validated_repos if not r["valid"]]
            if invalid:
                logger.info("MCP init: invalid repos (GitHub 404): %s", invalid)

        # ── Atlassian ─────────────────────────────────────────────────────────
        atlassian_enabled = status.get("atlassian", False)
        if atlassian_enabled:
            result.atlassian.enabled = True
            result.atlassian.available = True

        result.any_available = (
            result.db.available
            or result.github.available
            or result.atlassian.available
        )
        return result

    except Exception as e:
        logger.error("_run_mcp_init error: %s", e)
        return McpInitResult(ok=False)


# ─── Custom providers endpoint ───────────────────────────────────────────────

@router.get("/api/mcp/custom-providers")
async def list_custom_providers() -> list[dict]:
    """
    Return custom MCP providers from ~/.localwiki/mcp-config.yaml.

    Each item is shaped like an MCPProvider (edition="custom") so the frontend
    can render them alongside community/official providers without extra logic.
    """
    try:
        from cli.mcp.manager import load_config
        from cli.mcp.custom_mcp import load_custom_mcps
        import shutil

        cfg = await asyncio.to_thread(load_config)
        clients = await asyncio.to_thread(load_custom_mcps, cfg)
        return [
            {
                "id": c._config.key,
                "type": c._config.key,
                "name": c._config.description or c._config.key,
                "description": f"커스텀 MCP — {' '.join(c._config.command[:2])}",
                "icon": "terminal",
                "category": "custom",
                "edition": "custom",
                "isEnabled": c._config.enabled,
                "isConnected": False,
                "available": c.available,
                "config": {},
            }
            for c in clients
        ]
    except Exception as e:
        logger.warning("Failed to load custom providers: %s", e)
        return []


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.get("/api/mcp/local-config")
async def get_local_mcp_config():
    """
    Scan MCP config files from all known AI tools and return normalized provider configs.
    Returns: { providers: {id: config}, sources: {id: [tool, ...]} }
    """
    import json as _json
    import os as _os

    # ── Config file registry ────────────────────────────────────────────────────
    CONFIG_SOURCES: list[tuple[str, str]] = [
        ("claude",         "~/.claude.json"),
        ("cursor",         "~/.cursor/mcp.json"),
        ("gemini",         "~/.gemini/settings.json"),
        ("gemini",         "~/.gemini/mcp.json"),
        ("antigravity",    "~/.gemini/config/mcp_config.json"),
        ("antigravity-ide","~/.gemini/antigravity-ide/mcp_config.json"),
        ("kiro",           "~/.kiro/settings/mcp.json"),
    ]

    def _load_servers(path: str) -> dict:
        try:
            with open(_os.path.expanduser(path)) as f:
                data = _json.load(f)
            return data.get("mcpServers", {})
        except Exception:
            return {}

    def _https(host: str) -> str:
        if not host:
            return ""
        return host if host.startswith("http") else f"https://{host}"

    def _extract(servers: dict, result: dict, sources: dict[str, list[str]], tool: str) -> None:
        """Merge recognized MCPs from one config file into result/sources."""
        def _register(pid: str, cfg: dict) -> None:
            if pid not in result:
                result[pid] = {}
            # Only fill empty slots — first-found wins
            for k, v in cfg.items():
                if v and k not in result[pid]:
                    result[pid][k] = v
            if tool not in sources.get(pid, []):
                sources.setdefault(pid, []).append(tool)

        if "github" in servers:
            env = servers["github"].get("env", {})
            _register("github", {
                "apiUrl": env.get("GITHUB_ENDPOINT", ""),
                "apiToken": env.get("GITHUB_PERSONAL_ACCESS_TOKEN", ""),
            })

        if "jira" in servers:
            env = servers["jira"].get("env", {})
            _register("jira", {"apiUrl": _https(env.get("JIRA_HOST", ""))})

        for wiki_key in ("wiki", "confluence"):   # different tools use different key names
            if wiki_key in servers:
                env = servers[wiki_key].get("env", {})
                host = env.get("CONFLUENCE_HOST", "") or env.get("WIKI_HOST", "")
                if host:
                    _register("confluence", {"apiUrl": _https(host)})
                break

        if "devdb" in servers:
            s = servers["devdb"]
            url = s.get("url") or s.get("serverURL") or ""
            _register("devdb", {"apiUrl": url})

        if "oracle" in servers:
            env = servers["oracle"].get("env", {})
            _register("oracle", {"dbUrl": env.get("DB_URL", "")})

        if "meta" in servers:
            s = servers["meta"]
            env = s.get("env", {})
            args = s.get("args", [])
            script_dir = ""
            for i, arg in enumerate(args):
                if arg == "--directory" and i + 1 < len(args):
                    script_dir = args[i + 1]
                    break
            _register("meta", {
                "scriptDir": script_dir,
                "username": env.get("META_USERNAME", ""),
                "password": env.get("META_PASSWORD", ""),
            })

    result: dict[str, dict] = {}
    sources: dict[str, list[str]] = {}

    for tool_label, path in CONFIG_SOURCES:
        servers = _load_servers(path)
        if servers:
            _extract(servers, result, sources, tool_label)

    return {"providers": result, "sources": sources}


@router.post("/api/mcp/test")
async def test_mcp_connection(request: MCPTestRequest) -> MCPTestResult:
    """
    Test connectivity for a given MCP provider.

    Three-level check:
      1. Prerequisites  — required CLI tools are installed
      2. Config         — required fields are present
      3. Connectivity   — actual round-trip (REST or MCP stdio)
    """
    try:
        return await _dispatch(request.provider_type, request.config)
    except Exception as e:
        logger.error("MCP test error for %s: %s", request.provider_type, e)
        return MCPTestResult(ok=False, message=f"테스트 중 오류 발생: {e}")


# ─── Dispatch ─────────────────────────────────────────────────────────────────

async def _dispatch(provider_type: str, config: dict) -> MCPTestResult:
    if provider_type in ("postgresql", "mysql", "mongodb", "mssql", "mariadb"):
        return await _test_db(provider_type, config)
    if provider_type == "github":
        return await _test_github(config)
    if provider_type in ("jira", "confluence"):
        return await _test_atlassian(provider_type, config)
    if provider_type == "devdb":
        return await _test_devdb(config)
    if provider_type == "oracle":
        return await _test_oracle(config)
    if provider_type == "meta":
        return await _test_meta(config)
    return MCPTestResult(
        ok=False,
        message=f"{provider_type} MCP 테스트는 아직 지원되지 않습니다.",
        details={"provider": provider_type},
    )


# ─── Database (DBHub) ─────────────────────────────────────────────────────────

async def _test_db(db_type: str, config: dict) -> MCPTestResult:
    details: dict[str, Any] = {}

    # 1. Prerequisites
    if db_type != "oracle" and not shutil.which("npx"):
        return MCPTestResult(
            ok=False,
            message="❌ npx가 설치되어 있지 않습니다. Node.js를 설치하세요.",
            details={"missing": "npx"},
        )

    # 2. Build connection string from form fields
    connection_string = _build_db_connection_string(db_type, config)
    if not connection_string:
        return MCPTestResult(
            ok=False,
            message="❌ Host 정보가 입력되지 않았습니다.",
            details={"missing": "host"},
        )
    details["connection_string"] = _redact_password(connection_string)

    # 3. DBHub round-trip (threaded, 15s timeout)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_run_db_ping, db_type, connection_string),
            timeout=15.0,
        )
        return MCPTestResult(
            ok=result["ok"],
            message=result["message"],
            details={**details, **result.get("details", {})},
        )
    except asyncio.TimeoutError:
        return MCPTestResult(
            ok=False,
            message="❌ 연결 시간 초과 (15초). DB 접속 정보를 확인하세요.",
            details=details,
        )


def _build_db_connection_string(db_type: str, config: dict) -> str:
    # Allow explicit connection string override via options
    opts = config.get("options") or {}
    if isinstance(opts, dict) and opts.get("connectionString"):
        return opts["connectionString"]

    host = config.get("host", "")
    if not host:
        return ""

    port = config.get("port")
    user = config.get("username", "user")
    password = config.get("password") or config.get("apiToken", "")
    database = config.get("database", "")

    defaults = {"postgresql": 5432, "mysql": 3306, "mongodb": 27017, "mssql": 1433, "mariadb": 3306, "oracle": 1521}
    port = port or defaults.get(db_type, 5432)

    if db_type == "mongodb":
        auth = f"{user}:{password}@" if user and password else ""
        return f"mongodb://{auth}{host}:{port}/{database}"
    return f"{db_type}://{user}:{password}@{host}:{port}/{database}"


def _run_db_ping(db_type: str, connection_string: str) -> dict:
    """Synchronous DBHub ping — runs in thread pool."""
    try:
        import sys
        from pathlib import Path
        root = str(Path(__file__).resolve().parents[2])
        if root not in sys.path:
            sys.path.insert(0, root)

        from cli.mcp.db_mcp import DatabaseMCPClient, DBConfig
        from cli.mcp.base_client import MCPStdioClient

        cfg = DBConfig(db_type=db_type, connection_string=connection_string, enabled=True)
        client = DatabaseMCPClient(cfg)

        if not client.available:
            tool = "DBHub" if db_type != "oracle" else "Oracle SQLcl"
            return {"ok": False, "message": f"❌ {tool}를 실행할 수 없습니다. npm install -g dbhub 를 실행하세요."}

        cmd = client._build_command()
        with MCPStdioClient(cmd, timeout=10) as mcp:
            raw = mcp.call_tool("list_tables", {})
            tables = client._parse_table_list(raw)
            return {
                "ok": True,
                "message": f"✅ {db_type.upper()} 연결 성공! 테이블 {len(tables)}개 발견",
                "details": {"tables": tables[:10], "total": len(tables)},
            }
    except Exception as e:
        return {"ok": False, "message": f"❌ DB 연결 실패: {e}"}


# ─── GitHub ───────────────────────────────────────────────────────────────────

async def _test_github(config: dict) -> MCPTestResult:
    has_docker = bool(shutil.which("docker"))
    has_binary = bool(shutil.which("github-mcp-server"))
    details = {"docker": has_docker, "binary": has_binary}

    # 1. Prerequisites
    if not has_docker and not has_binary:
        return MCPTestResult(
            ok=False,
            message="❌ Docker 또는 github-mcp-server 바이너리가 필요합니다.",
            details=details,
        )

    # 2. Token present
    token = config.get("apiToken", "").strip()
    if not token:
        return MCPTestResult(
            ok=False,
            message="❌ GitHub Personal Access Token이 입력되지 않았습니다.",
            details=details,
        )

    # 3. Validate token via GitHub REST API (GHE or github.com)
    ghe_url = config.get("apiUrl", "").rstrip("/")
    if ghe_url:
        api_url = f"{ghe_url}/api/v3/user"
    else:
        api_url = "https://api.github.com/user"

    try:
        import httpx
        async with httpx.AsyncClient(timeout=8.0, verify=False) as client:
            resp = await client.get(
                api_url,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            )
        if resp.status_code == 200:
            user = resp.json()
            host = ghe_url or "github.com"
            return MCPTestResult(
                ok=True,
                message=f"✅ GitHub 연결 성공! ({user.get('login', 'unknown')}) — {host}",
                details={**details, "login": user.get("login"), "scopes": resp.headers.get("x-oauth-scopes", "")},
            )
        if resp.status_code == 401:
            return MCPTestResult(ok=False, message="❌ GitHub 토큰이 유효하지 않습니다.", details=details)
        return MCPTestResult(ok=False, message=f"❌ GitHub API 오류: HTTP {resp.status_code}", details=details)
    except Exception as e:
        return MCPTestResult(ok=False, message=f"❌ GitHub 연결 오류: {e}", details=details)


# ─── Atlassian (Jira / Confluence) ────────────────────────────────────────────

async def _test_atlassian(provider_type: str, config: dict) -> MCPTestResult:
    has_npx = bool(shutil.which("npx"))
    details = {"npx": has_npx}

    # 1. Prerequisites — uses npx @atlassian-dc-mcp/jira (Data Center)
    if not has_npx:
        return MCPTestResult(
            ok=False,
            message="❌ npx가 필요합니다. Node.js를 설치하세요.",
            details=details,
        )

    # 2. Config completeness
    api_url = (config.get("apiUrl") or "").rstrip("/")
    if not api_url:
        return MCPTestResult(ok=False, message="❌ Host URL이 입력되지 않았습니다.", details=details)
    token = (config.get("apiToken") or "").strip()
    if not token:
        return MCPTestResult(ok=False, message="❌ API Token이 입력되지 않았습니다.", details=details)

    # 3. Jira DC: GET /rest/api/2/myself (v2, no auth token — SSO via session)
    #    Accept any 2xx or 3xx (redirect to SSO login also proves server is reachable)
    try:
        import httpx

        headers: dict = {"Accept": "application/json"}
        if token:
            import base64
            username = (config.get("username") or "").strip()
            if username:
                auth = base64.b64encode(f"{username}:{token}".encode()).decode()
                headers["Authorization"] = f"Basic {auth}"
            else:
                headers["Authorization"] = f"Bearer {token}"

        # Jira DC: /rest/api/2/myself  |  Confluence DC: /rest/api/user/current
        test_path = "/rest/api/2/myself" if provider_type == "jira" else "/rest/api/user/current"
        async with httpx.AsyncClient(timeout=8.0, verify=False, follow_redirects=False) as client:
            resp = await client.get(f"{api_url}{test_path}", headers=headers)

        if resp.status_code == 200:
            user = resp.json()
            display = user.get("emailAddress") or user.get("displayName") or user.get("username") or user.get("name", "unknown")
            return MCPTestResult(
                ok=True,
                message=f"✅ 연결 성공! ({display}) — {api_url}",
                details={**details, "user": display},
            )
        if resp.status_code in (301, 302, 303, 307, 308):
            # Redirect to SSO login = server is up but needs browser auth
            return MCPTestResult(
                ok=True,
                message=f"✅ 서버 응답 확인 ({api_url}) — SSO 로그인 필요 (MCP는 정상 동작)",
                details={**details, "status": resp.status_code},
            )
        if resp.status_code == 401:
            return MCPTestResult(
                ok=True,
                message=f"✅ 서버 응답 확인 ({api_url}) — 인증 필요 (MCP DC 모드에서는 정상)",
                details={**details, "status": 401},
            )
        return MCPTestResult(ok=False, message=f"❌ 서버 오류: HTTP {resp.status_code}", details=details)
    except Exception as e:
        return MCPTestResult(ok=False, message=f"❌ 연결 오류: {e}", details=details)


# ─── Oracle (uvx --with oracledb mcp-alchemy) ────────────────────────────────

async def _test_oracle(config: dict) -> MCPTestResult:
    """
    Oracle via mcp-alchemy.
    Setup: uvx --with oracledb mcp-alchemy  (env: DB_URL=oracle+oracledb://...)
    Test: verify uvx is available + DB_URL is present and plausibly valid.
    """
    db_url = (config.get("dbUrl") or "").strip()

    # 1. Prerequisites
    if not shutil.which("uvx"):
        return MCPTestResult(
            ok=False,
            message="❌ uvx가 설치되어 있지 않습니다. uv를 설치하세요: https://docs.astral.sh/uv/",
            details={"missing": "uvx"},
        )

    # 2. DB_URL provided?
    if not db_url:
        return MCPTestResult(
            ok=False,
            message="❌ DB_URL이 입력되지 않았습니다. oracle+oracledb://USER:PASS@HOST:PORT/?service_name=SVC 형식으로 입력하세요.",
            details={"missing": "dbUrl"},
        )

    # 3. Format check
    if not db_url.startswith("oracle+oracledb://"):
        return MCPTestResult(
            ok=False,
            message=f"❌ DB_URL 형식 오류 — oracle+oracledb:// 로 시작해야 합니다. 현재: {db_url[:40]}…",
            details={"dbUrl_prefix": db_url[:40]},
        )

    # 4. Light reachability: try connecting via oracledb thin mode
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_ping_oracle, db_url),
            timeout=12.0,
        )
        return MCPTestResult(ok=result["ok"], message=result["message"], details=result.get("details", {}))
    except asyncio.TimeoutError:
        return MCPTestResult(
            ok=False,
            message="❌ Oracle 연결 시간 초과 (12초). HOST와 서비스명을 확인하세요.",
            details={"dbUrl": db_url[:40]},
        )


def _ping_oracle(db_url: str) -> dict:
    """Try oracledb thin-mode ping in a thread pool."""
    try:
        import re
        m = re.match(r"oracle\+oracledb://([^:]+):([^@]+)@([^:/]+):?(\d+)?/?\??service_name=([^&]+)", db_url)
        if not m:
            return {"ok": False, "message": f"❌ DB_URL 파싱 실패. 형식: oracle+oracledb://USER:PASS@HOST:PORT/?service_name=SVC"}
        user, password, host, port_s, service = m.groups()
        import urllib.parse
        password = urllib.parse.unquote(password)
        port = int(port_s) if port_s else 1521
        import oracledb
        oracledb.init_oracle_client = lambda *a, **kw: None  # thin mode — no client needed
        conn = oracledb.connect(user=user, password=password, dsn=f"{host}:{port}/{service}", mode=oracledb.SYSDBA if False else 0)
        conn.close()
        return {"ok": True, "message": f"✅ Oracle 연결 성공! ({host}:{port}/{service})"}
    except ModuleNotFoundError:
        # oracledb not importable here; just accept uvx will handle it at runtime
        return {"ok": True, "message": "✅ uvx + DB_URL 설정 확인 완료 (런타임 연결은 mcp-alchemy가 처리)"}
    except Exception as e:
        return {"ok": False, "message": f"❌ Oracle 연결 실패: {e}"}


# ─── DevDB (SQL Server via HTTP/SSE MCP) ─────────────────────────────────────

async def _test_devdb(config: dict) -> MCPTestResult:
    sse_url = (config.get("apiUrl") or "").rstrip("/")
    if not sse_url:
        return MCPTestResult(ok=False, message="❌ Server URL이 입력되지 않았습니다.", details={})

    # SSE 서버 가용성 확인 — 어떤 HTTP 응답이든 오면 서버가 살아있는 것
    try:
        import httpx
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=6.0, read=3.0, write=6.0, pool=6.0), verify=False) as client:
            resp = await client.get(sse_url, headers={"Accept": "text/event-stream"})
        if resp.status_code < 500:
            return MCPTestResult(
                ok=True,
                message=f"✅ DevDB MCP 연결 성공! ({sse_url})",
                details={"url": sse_url, "status": resp.status_code},
            )
        return MCPTestResult(
            ok=False,
            message=f"❌ DevDB MCP 서버 오류: HTTP {resp.status_code}",
            details={"url": sse_url},
        )
    except Exception as e:
        return MCPTestResult(
            ok=False,
            message=f"❌ DevDB MCP 연결 실패: {e}",
            details={"url": sse_url},
        )


# ─── Meta DB Portal (uv run local script + AD credentials) ───────────────────

async def _test_meta(config: dict) -> MCPTestResult:
    """
    meta MCP: uv run --directory <scriptDir> main.py
    env: META_USERNAME=<username>  META_PASSWORD=<password>
    Test: verify uv available + scriptDir/main.py exists + credentials provided.
    """
    import os
    from pathlib import Path

    # 1. Prerequisites
    if not shutil.which("uv"):
        return MCPTestResult(
            ok=False,
            message="❌ uv가 설치되어 있지 않습니다: https://docs.astral.sh/uv/",
            details={"missing": "uv"},
        )

    # 2. Script directory
    script_dir = (config.get("scriptDir") or "").strip()
    if not script_dir:
        return MCPTestResult(
            ok=False,
            message="❌ Script Directory가 설정되지 않았습니다. main.py가 있는 디렉토리 경로를 입력하세요.",
            details={"missing": "scriptDir"},
        )

    script_path = Path(os.path.expanduser(script_dir)) / "main.py"
    if not script_path.exists():
        return MCPTestResult(
            ok=False,
            message=f"❌ main.py를 찾을 수 없습니다: {script_path}",
            details={"path": str(script_path)},
        )

    # 3. AD credentials
    ad_id = (config.get("username") or "").strip()
    ad_pwd = (config.get("password") or "").strip()
    if not ad_id or not ad_pwd:
        return MCPTestResult(
            ok=False,
            message="❌ AD ID 또는 AD Password가 입력되지 않았습니다.",
            details={"missing": "username or password"},
        )

    return MCPTestResult(
        ok=True,
        message=f"✅ meta MCP 설정 확인 완료 — uv 설치됨, {script_path.name} 존재, 자격증명 입력됨",
        details={
            "script": str(script_path),
            "ad_id": ad_id,
            "uv": shutil.which("uv"),
        },
    )


# ─── Per-project MCP config ───────────────────────────────────────────────────

class ProjectMcpConfigBody(BaseModel):
    config: dict[str, Any]


@router.get("/api/projects/{project_id:path}/mcp-config")
async def get_project_mcp_config(project_id: str):
    from api.db.store import project_settings_store
    cfg = project_settings_store.get(project_id, "mcp_config")
    return {"project_id": project_id, "config": cfg, "found": cfg is not None}


@router.put("/api/projects/{project_id:path}/mcp-config")
async def put_project_mcp_config(project_id: str, body: ProjectMcpConfigBody):
    from api.db.store import project_settings_store, project_store
    # Ensure project row exists first (upsert with minimal fields)
    existing = project_store.get(project_id)
    if not existing:
        parts = project_id.split(":")
        if len(parts) >= 3:
            owner, repo_name, lang = parts[0], parts[1], parts[2]
            project_store.upsert(project_id, owner, repo_name, lang)
        else:
            return {"ok": False, "error": "project not found and project_id format invalid"}
    project_settings_store.set(project_id, "mcp_config", body.config)
    return {"ok": True}


@router.delete("/api/projects/{project_id:path}/mcp-config")
async def delete_project_mcp_config(project_id: str):
    from api.db.store import project_settings_store
    project_settings_store.delete(project_id, "mcp_config")
    return {"ok": True}


# ─── Utils ────────────────────────────────────────────────────────────────────

def _redact_password(cs: str) -> str:
    return re.sub(r"(://[^:]+:)[^@]+(@)", r"\1****\2", cs) if cs else ""
