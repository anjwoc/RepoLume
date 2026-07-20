import os
import logging
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from typing import List, Optional, Dict, Any, Literal
import json
from datetime import datetime
from pydantic import BaseModel, Field
import google.generativeai as genai
import asyncio
import shutil
import time

# Configure logging
from api.logging_config import setup_logging
from api import db as project_db

setup_logging()
logger = logging.getLogger(__name__)


# Initialize FastAPI app
app = FastAPI(
    title="Streaming API",
    description="API for streaming chat completions"
)

# SQLite 프로젝트 레지스트리 초기화 (외부 의존성 없음 — Electron 포함 모든 환경)
try:
    project_db.init_db()
except Exception as _db_init_err:
    logger.warning(f"[db] 초기화 실패 (무시): {_db_init_err}")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Helper function to get adalflow root path
def get_adalflow_default_root_path():
    return os.path.expanduser(os.path.join("~", ".adalflow"))

# --- Pydantic Models ---
class WikiPage(BaseModel):
    """
    Model for a wiki page.
    """
    id: str = Field(default="")
    title: str = Field(default="")
    content: str = Field(default="")
    filePaths: List[str] = Field(default_factory=list)
    importance: str = Field(default="") # Should ideally be Literal['high', 'medium', 'low']
    relatedPages: List[str] = Field(default_factory=list)

class ProcessedProjectEntry(BaseModel):
    id: str  # Filename
    owner: str
    repo: str
    name: str  # owner/repo
    repo_type: str # Renamed from type to repo_type for clarity with existing models
    submittedAt: int # Timestamp
    language: str # Extracted from filename
    model: Optional[str] = None

class RepoInfo(BaseModel):
    owner: str
    repo: str
    type: str
    token: Optional[str] = None
    localPath: Optional[str] = None
    repoUrl: Optional[str] = None


class WikiSection(BaseModel):
    """
    Model for the wiki sections.
    """
    id: str = Field(default="")
    title: str = Field(default="")
    pages: List[str] = Field(default_factory=list)
    subsections: Optional[List[str]] = None


class WikiStructureModel(BaseModel):
    """
    Model for the overall wiki structure.
    """
    id: str = Field(default="wiki")
    title: str = Field(default="")
    description: str = Field(default="")
    pages: List[WikiPage] = Field(default_factory=list)
    sections: Optional[List[WikiSection]] = None
    rootSections: Optional[List[str]] = None
    items: Optional[List[Any]] = None # Just in case the agent outputs items instead
class WikiCacheData(BaseModel):
    """
    Model for the data to be stored in the wiki cache.
    """
    wiki_structure: WikiStructureModel
    generated_pages: Dict[str, WikiPage]
    repo_url: Optional[str] = None  #compatible for old cache
    repo: Optional[RepoInfo] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    language: Optional[str] = None

class WikiCacheRequest(BaseModel):
    """
    Model for the request body when saving wiki cache.
    """
    repo: RepoInfo
    language: str
    wiki_structure: WikiStructureModel
    generated_pages: Dict[str, WikiPage]
    provider: str
    model: Optional[str] = None

class WikiExportRequest(BaseModel):
    """
    Model for requesting a wiki export.
    """
    repo_url: str = Field(..., description="URL of the repository")
    pages: List[WikiPage] = Field(..., description="List of wiki pages to export")
    format: Literal["markdown", "json"] = Field(..., description="Export format (markdown or json)")
    # markdown only: "single" = one concatenated .md, "tree" = zip mirroring the
    # section/page directory structure. Ignored for json.
    structure: Literal["single", "tree"] = Field("single", description="Markdown layout: single file or directory-tree zip")
    wiki_structure: Optional[WikiStructureModel] = Field(None, description="Section hierarchy, required for tree export")

# --- Model Configuration Models ---
class Model(BaseModel):
    """
    Model for LLM model configuration
    """
    id: str = Field(..., description="Model identifier")
    name: str = Field(..., description="Display name for the model")

class Provider(BaseModel):
    """
    Model for LLM provider configuration
    """
    id: str = Field(..., description="Provider identifier")
    name: str = Field(..., description="Display name for the provider")
    models: List[Model] = Field(..., description="List of available models for this provider")
    supportsCustomModel: Optional[bool] = Field(False, description="Whether this provider supports custom models")

class ModelConfig(BaseModel):
    """
    Model for the entire model configuration
    """
    providers: List[Provider] = Field(..., description="List of available model providers")
    defaultProvider: str = Field(..., description="ID of the default provider")

class AuthorizationConfig(BaseModel):
    code: str = Field(..., description="Authorization code")

from api.config import configs, WIKI_AUTH_MODE, WIKI_AUTH_CODE
from api.task_streams import router as task_stream_router
from api.agent_runner import AgentRegistry
from api.auth_pty import check_auth_status, start_auth_session, submit_auth_code

class AuthCodeSubmit(BaseModel):
    code: str

app.include_router(task_stream_router)
from api.mcp_api import router as mcp_api_router
app.include_router(mcp_api_router)

# --- Agent Endpoints (replaces localwiki-agent Go binary) ---

@app.get("/agent/list")
async def agent_list():
    """List all CLI agents and their availability status."""
    registry = AgentRegistry()
    return {"agents": registry.status(), "available": registry.available()}


@app.get("/agent/check/{agent_name}")
async def agent_check(agent_name: str):
    """Check if a specific CLI agent is installed and available."""
    registry = AgentRegistry()
    try:
        runner = registry.get(agent_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    available = runner.available()
    return {
        "agent": agent_name,
        "available": available,
        "default_model": runner.default_model,
    }

@app.get("/agent/auth/status")
async def agent_auth_status():
    is_authed = await check_auth_status()
    return {"authenticated": is_authed}

@app.post("/agent/auth/start")
async def agent_auth_start():
    result = await start_auth_session()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result

@app.post("/agent/auth/submit")
async def agent_auth_submit(data: AuthCodeSubmit):
    result = await submit_auth_code(data.code)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result

@app.get("/api/fs/select_folder")
async def select_folder():
    """
    Opens a native folder picker dialog on the host OS and returns the absolute path.
    """
    import os
    import platform
    import subprocess
    
    try:
        # Try applescript on Mac first since tkinter can have focus/loop issues in a web server thread
        if platform.system() == "Darwin":
            script = '''
            tell application (path to frontmost application as text)
                activate
                set folderPath to choose folder with prompt "Select Project Folder"
                POSIX path of folderPath
            end tell
            '''
            result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return {"path": result.stdout.strip()}
            else:
                print(f"AppleScript returned non-zero or empty. Err: {result.stderr}")
                return {"path": ""}
            
        # Fallback to tkinter
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder_path = filedialog.askdirectory(title="Select Project Folder")
        root.destroy()
        return {"path": folder_path}
    except Exception as e:
        print(f"Error opening folder picker: {e}")
        return {"path": ""}


@app.get("/lang/config")
async def get_lang_config():
    return configs["lang_config"]

@app.get("/auth/status")
async def get_auth_status():
    """
    Check if authentication is required for the wiki.
    """
    return {"auth_required": WIKI_AUTH_MODE}

@app.post("/auth/validate")
async def validate_auth_code(request: AuthorizationConfig):
    """
    Check authorization code.
    """
    return {"success": WIKI_AUTH_CODE == request.code}

@app.get("/models/config", response_model=ModelConfig)
async def get_model_config():
    """
    Get available model providers and their models.

    This endpoint returns the configuration of available model providers and their
    respective models that can be used throughout the application.

    Returns:
        ModelConfig: A configuration object containing providers and their models
    """
    try:
        logger.info("Fetching model configurations")

        # Create providers from the config file
        providers = []
        default_provider = configs.get("default_provider", "google")

        # Add provider configuration based on config.py
        for provider_id, provider_config in configs["providers"].items():
            models = []
            # Add models from config
            for model_id in provider_config["models"].keys():
                # Get a more user-friendly display name if possible
                models.append(Model(id=model_id, name=model_id))

            # Add provider with its models
            providers.append(
                Provider(
                    id=provider_id,
                    name=f"{provider_id.capitalize()}",
                    supportsCustomModel=provider_config.get("supportsCustomModel", False),
                    models=models
                )
            )

        # Create and return the full configuration
        config = ModelConfig(
            providers=providers,
            defaultProvider=default_provider
        )
        return config

    except Exception as e:
        logger.error(f"Error creating model configuration: {str(e)}")
        # Return some default configuration in case of error
        return ModelConfig(
            providers=[
                Provider(
                    id="google",
                    name="Google",
                    supportsCustomModel=True,
                    models=[
                        Model(id="gemini-2.5-flash", name="Gemini 2.5 Flash")
                    ]
                )
            ],
            defaultProvider="google"
        )

@app.post("/export/wiki")
async def export_wiki(request: WikiExportRequest):
    """
    Export wiki content as Markdown or JSON.

    Args:
        request: The export request containing wiki pages and format

    Returns:
        A downloadable file in the requested format
    """
    try:
        logger.info(f"Exporting wiki for {request.repo_url} in {request.format} format")

        # Extract repository name from URL for the filename
        repo_parts = request.repo_url.rstrip('/').split('/')
        repo_name = repo_parts[-1] if len(repo_parts) > 0 else "wiki"

        # Get current timestamp for the filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        if request.format == "markdown" and request.structure == "tree":
            # Directory-tree zip mirroring the section/page hierarchy.
            content = generate_markdown_tree_zip(
                request.repo_url, request.pages, request.wiki_structure
            )
            response = Response(
                content=content,
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={repo_name}_wiki_{timestamp}.zip"},
            )
            return response
        elif request.format == "markdown":
            # Generate Markdown content
            content = generate_markdown_export(request.repo_url, request.pages)
            filename = f"{repo_name}_wiki_{timestamp}.md"
            media_type = "text/markdown"
        else:  # JSON format
            # Generate JSON content
            content = generate_json_export(request.repo_url, request.pages)
            filename = f"{repo_name}_wiki_{timestamp}.json"
            media_type = "application/json"

        # Create response with appropriate headers for file download
        response = Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

        return response

    except Exception as e:
        error_msg = f"Error exporting wiki: {str(e)}"
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

@app.post("/export/notion")
async def export_notion(request: WikiExportRequest, api_key: str = Query(...), parent_page_id: str = Query(...)):
    """Export wiki pages to a Notion database."""
    try:
        from cli.exporters.notion_exporter import NotionExporter
        exporter = NotionExporter(api_key=api_key, parent_page_id=parent_page_id)
        
        repo_parts = request.repo_url.rstrip('/').split('/')
        repo_name = repo_parts[-1] if len(repo_parts) > 0 else "wiki"
        
        result = exporter.export(request.pages, wiki_title=f"{repo_name} Wiki")
        
        if result.failed:
            raise HTTPException(status_code=500, detail="\\n".join(result.errors))
            
        return {"success": True, "exported_count": result.exported_count, "urls": result.urls}
    except Exception as e:
        logger.error(f"Notion export error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export/obsidian")
async def export_obsidian(request: WikiExportRequest, vault_path: str = Query(...)):
    """Export wiki pages to a local Obsidian vault."""
    try:
        from cli.exporters.obsidian_exporter import ObsidianExporter
        exporter = ObsidianExporter(vault_path=vault_path)
        
        repo_parts = request.repo_url.rstrip('/').split('/')
        repo_name = repo_parts[-1] if len(repo_parts) > 0 else "wiki"
        
        result = exporter.export(request.pages, wiki_title=f"{repo_name} Wiki")
        
        if result.failed:
            raise HTTPException(status_code=500, detail="\\n".join(result.errors))
            
        return {"success": True, "exported_count": result.exported_count, "output_path": result.output_path}
    except Exception as e:
        logger.error(f"Obsidian export error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class AnalyzeBusinessRequest(BaseModel):
    repo_url: Optional[str] = None
    repo_urls: Optional[List[str]] = None
    language: str = "en"
    provider: Optional[str] = None
    model: Optional[str] = None
    mode: Optional[Literal["cli", "api"]] = "cli"
    cli_tool: Optional[str] = None
    api_key: Optional[str] = None


class MultiRepoBusinessContext:
    """Minimal repo adapter that lets BusinessAnalyzer read multiple repos as one system."""

    def __init__(self, repos: List[Any]):
        self.repos = repos
        self.path = repos[0].path

    def file_tree(self, max_depth: int = 6) -> str:
        parts = []
        for repo in self.repos:
            parts.append(f"## Repository: {repo.path.name}\nRoot: {repo.path}\n{repo.file_tree(max_depth=max_depth)}")
        return "\n\n".join(parts)

    def readme(self) -> str:
        parts = []
        for repo in self.repos:
            readme = repo.readme() or "(no README found)"
            parts.append(f"## Repository: {repo.path.name}\nRoot: {repo.path}\n\n{readme}")
        return "\n\n---\n\n".join(parts)

    def read_file(self, relative_path: str) -> str:
        for repo in self.repos:
            content = repo.read_file(relative_path)
            if content:
                return content
        return ""


def _business_repo_paths(request: AnalyzeBusinessRequest) -> List[str]:
    raw_paths = request.repo_urls if request.repo_urls else ([request.repo_url] if request.repo_url else [])
    seen = set()
    paths = []
    for raw in raw_paths:
        if not raw:
            continue
        path = raw.strip()
        if path and path not in seen:
            seen.add(path)
            paths.append(path)
    return paths


def _business_provider_name(request: AnalyzeBusinessRequest) -> str:
    provider = (request.provider or "google").lower().strip()
    cli_tool = (request.cli_tool or "").lower().strip()
    mode = request.mode or "cli"

    if mode == "cli":
        agent = cli_tool or {
            "google": "gemini",
            "gemini": "gemini",
            "anthropic": "claude",
            "claude": "claude",
            "openai": "codex",
            "codex": "codex",
            "antigravity": "antigravity",
        }.get(provider, "codex")
        return f"{agent}-cli"

    return {
        "google": "gemini",
        "anthropic": "claude",
        "openai": "openai",
        "codex": "openai",
        "gemini": "gemini",
        "claude": "claude",
    }.get(provider, provider)

@app.post("/analyze_business")
async def analyze_business(request: AnalyzeBusinessRequest):
    """Run business analysis (data flow, workflow, impact) and return markdown pages."""
    try:
        from cli.pipeline.local_repo import LocalRepo
        from cli.providers import get_provider
        from cli.business import BusinessAnalyzer

        requested_paths = _business_repo_paths(request)
        if not requested_paths:
            raise HTTPException(status_code=400, detail="repo_url or repo_urls is required")

        repos = []
        warnings = []
        for repo_path in requested_paths:
            try:
                repos.append(LocalRepo(repo_path))
            except Exception as exc:
                warnings.append(f"{repo_path}: {exc}")

        if not repos:
            raise HTTPException(status_code=404, detail={"message": "No valid repositories found", "warnings": warnings})

        provider_kwargs: Dict[str, Any] = {}
        if request.api_key and (request.mode or "cli") != "cli":
            provider_kwargs["api_key"] = request.api_key

        provider = get_provider(
            _business_provider_name(request),
            model=request.model or None,
            cwd=str(repos[0].path),
            **provider_kwargs,
        )

        repo = repos[0] if len(repos) == 1 else MultiRepoBusinessContext(repos)
        repo_name = repos[0].path.name if len(repos) == 1 else f"{repos[0].path.name} and {len(repos) - 1} related repos"

        analyzer = BusinessAnalyzer(provider, repo, repo_name=repo_name)
        analysis = await asyncio.to_thread(analyzer.analyze, lang=request.language)

        return {
            "success": True,
            "repo_count": len(repos),
            "is_multi_repo": len(repos) > 1,
            "warnings": warnings,
            "pages": {
                "__business_overview__": analysis.business_summary_md,
                "__business_dataflow__": analysis.data_flow_summary_md,
                "__business_workflow__": analysis.workflow_summary_md,
                "__business_impact__": analysis.impact_summary_md,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Business analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/local_repo/structure")
async def get_local_repo_structure(path: str = Query(None, description="Path to local repository")):
    """Return the file tree and README content for a local repository."""
    if not path:
        return JSONResponse(
            status_code=400,
            content={"error": "No path provided. Please provide a 'path' query parameter."}
        )

    if not os.path.isdir(path):
        return JSONResponse(
            status_code=404,
            content={"error": f"Directory not found: {path}"}
        )

    try:
        logger.info(f"Processing local repository at: {path}")
        file_tree_lines = []
        readme_content = ""

        for root, dirs, files in os.walk(path):
            # Exclude hidden dirs/files and virtual envs, plus common large build/vendor directories
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('__pycache__', 'node_modules', '.venv', 'dist', 'build', 'out', 'coverage', 'vendor')]
            for file in files:
                if file.startswith('.') or file == '__init__.py' or file == '.DS_Store':
                    continue
                rel_dir = os.path.relpath(root, path)
                rel_file = os.path.join(rel_dir, file) if rel_dir != '.' else file
                file_tree_lines.append(rel_file)
                # Find README.md (case-insensitive)
                if file.lower() == 'readme.md' and not readme_content:
                    try:
                        with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                            readme_content = f.read()
                    except Exception as e:
                        logger.warning(f"Could not read README.md: {str(e)}")
                        readme_content = ""

        file_tree_str = '\n'.join(sorted(file_tree_lines))
        return {"file_tree": file_tree_str, "readme": readme_content}
    except Exception as e:
        logger.error(f"Error processing local repository: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Error processing local repository: {str(e)}"}
        )

def generate_markdown_export(repo_url: str, pages: List[WikiPage]) -> str:
    """
    Generate Markdown export of wiki pages.

    Args:
        repo_url: The repository URL
        pages: List of wiki pages

    Returns:
        Markdown content as string
    """
    # Start with metadata
    markdown = f"# Wiki Documentation for {repo_url}\n\n"
    markdown += f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"

    # Add table of contents
    markdown += "## Table of Contents\n\n"
    for page in pages:
        markdown += f"- [{page.title}](#{page.id})\n"
    markdown += "\n"

    # Add each page
    for page in pages:
        markdown += f"<a id='{page.id}'></a>\n\n"
        markdown += f"## {page.title}\n\n"



        # Add related pages
        if page.relatedPages and len(page.relatedPages) > 0:
            markdown += "### Related Pages\n\n"
            related_titles = []
            for related_id in page.relatedPages:
                # Find the title of the related page
                related_page = next((p for p in pages if p.id == related_id), None)
                if related_page:
                    related_titles.append(f"[{related_page.title}](#{related_id})")

            if related_titles:
                markdown += "Related topics: " + ", ".join(related_titles) + "\n\n"

        # Add page content
        markdown += f"{page.content}\n\n"
        markdown += "---\n\n"

    return markdown

def generate_markdown_tree_zip(
    repo_url: str,
    pages: List[WikiPage],
    wiki_structure: Optional[WikiStructureModel],
) -> bytes:
    """
    Build a zip archive mirroring the wiki's section/page directory structure:
    one .md per page under a per-section folder, plus a root index.md (TOC).
    Pages not assigned to any section are written at the archive root.
    """
    import io
    import re
    import zipfile

    def slug(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")

    page_by_id = {p.id: p for p in pages}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    index_lines = [f"# Wiki Documentation for {repo_url}\n", f"\nGenerated on: {timestamp}\n"]
    used_ids = set()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        sections = (wiki_structure.sections or []) if wiki_structure else []
        for i, section in enumerate(sections, 1):
            sec_dir = f"{i:02d}-{slug(section.title) or section.id}"
            index_lines.append(f"\n## {section.title}\n")
            for pid in section.pages:
                page = page_by_id.get(pid)
                if not page:
                    continue
                used_ids.add(pid)
                fname = f"{sec_dir}/{slug(page.title) or page.id}.md"
                zf.writestr(fname, f"# {page.title}\n\n{page.content}\n")
                index_lines.append(f"- [{page.title}]({fname})\n")

        # Orphan pages (not referenced by any section) at the archive root.
        orphans = [p for p in pages if p.id not in used_ids]
        if orphans:
            index_lines.append("\n## Other\n")
            for page in orphans:
                fname = f"{slug(page.title) or page.id}.md"
                zf.writestr(fname, f"# {page.title}\n\n{page.content}\n")
                index_lines.append(f"- [{page.title}]({fname})\n")

        zf.writestr("index.md", "".join(index_lines))

    return buf.getvalue()


def generate_json_export(repo_url: str, pages: List[WikiPage]) -> str:
    """
    Generate JSON export of wiki pages.

    Args:
        repo_url: The repository URL
        pages: List of wiki pages

    Returns:
        JSON content as string
    """
    # Create a dictionary with metadata and pages
    export_data = {
        "metadata": {
            "repository": repo_url,
            "generated_at": datetime.now().isoformat(),
            "page_count": len(pages)
        },
        "pages": [page.model_dump() for page in pages]
    }

    # Convert to JSON string with pretty formatting
    return json.dumps(export_data, indent=2)

# Import the simplified chat implementation
from api.simple_chat import chat_completions_stream, ChatCompletionRequest
from api.websocket_wiki import handle_websocket_chat

# Add the chat_completions_stream endpoint to the main app
app.add_api_route("/chat/completions/stream", chat_completions_stream, methods=["POST"])

# Add the WebSocket endpoint
app.add_websocket_route("/ws/chat", handle_websocket_chat)


# ---------------------------------------------------------------------------
# Diagram Fix — Event-based, fully backend-driven
# ---------------------------------------------------------------------------

class FixDiagramRequest(BaseModel):
    owner: str
    repo: str
    repo_type: str = "local"
    language: str = "en"
    model: Optional[str] = None
    page_id: str
    chart_code: str
    custom_instruction: Optional[str] = None
    provider: str = "google"
    use_cli: bool = True
    cli_tool: str = "gemini"


@app.post("/api/fix_diagram", status_code=202)
async def fix_diagram(request: FixDiagramRequest):
    """
    Fire-and-forget diagram fix.

    Immediately returns {status: "queued", job_id} so the frontend can
    navigate away.  A background asyncio task:
      1. Calls the LLM to fix/modify the diagram.
      2. Reads the wiki cache.
      3. Replaces the old chart code with the new one.
      4. Saves the cache back to disk.
      5. Emits a task-stream event so a listening frontend gets notified.
    """
    import re as _re
    from api.agent_runner import AgentRegistry
    from api.task_streams import emit_task_event

    job_id = __import__("uuid").uuid4().hex

    fix_prompt = (
        f"Modify the following Mermaid diagram according to the user's instruction.\n"
        f"User Instruction: {request.custom_instruction}\n"
        f"Output ONLY the modified diagram inside a ```mermaid ... ``` block. "
        f"Do not add any conversational text.\n\n"
        f"Original Diagram:\n```mermaid\n{request.chart_code}\n```"
    ) if request.custom_instruction else (
        f"The following Mermaid diagram has a syntax error.\n"
        f"Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, "
        f"newline chars in labels). Keep all node/edge label text in its ORIGINAL "
        f"language — do NOT translate labels. Output ONLY the corrected diagram inside a "
        f"```mermaid ... ``` block. Do not add any conversational text.\n\n"
        f"Original Diagram:\n```mermaid\n{request.chart_code}\n```"
    )

    async def _bg_fix():
        try:
            await emit_task_event(job_id, "status", "다이어그램 수정 중...", phase="fix_diagram")

            # Resolve CWD — reuse the same cache lookup used elsewhere
            cwd = "."
            if request.repo_type == "local":
                try:
                    cache_path = get_wiki_cache_path(
                        request.owner, request.repo, request.repo_type,
                        request.language, request.model,
                    )
                    if not os.path.exists(cache_path):
                        # Try without model suffix
                        cache_path = get_wiki_cache_path(
                            request.owner, request.repo, request.repo_type,
                            request.language,
                        )
                    if os.path.exists(cache_path):
                        with open(cache_path, "r", encoding="utf-8") as f:
                            _cd = json.load(f)
                        local_path = (_cd.get("repo") or {}).get("localPath") or \
                                     (_cd.get("repo") or {}).get("repoUrl") or "."
                        if local_path and os.path.isdir(local_path):
                            cwd = local_path
                except Exception as e:
                    logger.warning(f"fix_diagram: could not resolve cwd: {e}")

            # Pick agent
            agent_name = request.cli_tool if request.use_cli else "gemini"
            if agent_name == "gemini" and (request.model or "").startswith("agy-"):
                agent_name = "antigravity"
            registry = AgentRegistry()
            runner = registry.get(agent_name)

            result = await runner.run_collect(
                fix_prompt,
                cwd=cwd,
                model=request.model or "",
                timeout=180,
            )

            if result.error:
                raise RuntimeError(f"Agent error: {result.error}")

            raw = result.content
            match = (
                _re.search(r"```mermaid\n([\s\S]*?)\n```", raw, _re.IGNORECASE) or
                _re.search(r"```\n([\s\S]*?)\n```", raw)
            )
            new_code = match.group(1).strip() if match else raw.strip()
            new_code = _re.sub(r"^```(mermaid)?\n", "", new_code, flags=_re.IGNORECASE)
            new_code = _re.sub(r"\n```$", "", new_code).strip()

            if not new_code:
                raise RuntimeError("LLM 응답에서 다이어그램 코드를 추출하지 못했습니다.")

            # Read current cache, patch the page content, save back
            cache_data = await read_wiki_cache(
                request.owner, request.repo, request.repo_type,
                request.language, request.model,
            )
            if cache_data is None:
                cache_data = await read_wiki_cache(
                    request.owner, request.repo, request.repo_type,
                    request.language,
                )
            if cache_data is None:
                raise RuntimeError("캐시를 찾을 수 없습니다.")

            page = cache_data.generated_pages.get(request.page_id)
            if page is None:
                raise RuntimeError(f"페이지 '{request.page_id}'를 캐시에서 찾을 수 없습니다.")

            old_content = page.content
            norm_old = old_content.replace('\r\n', '\n')
            norm_chart = request.chart_code.replace('\r\n', '\n')
            # The frontend captures the chart from rendered (normalized) markdown,
            # which HTML-escapes stray tag-like tokens (e.g. the mermaid arrow
            # `<-->` -> `&lt;--&gt;`). The stored source keeps the raw token, so
            # un-escape the common entities before matching against the source.
            def _unescape(s: str) -> str:
                return (s.replace('&lt;', '<').replace('&gt;', '>')
                         .replace('&quot;', '"').replace('&#39;', "'")
                         .replace('&amp;', '&'))
            norm_chart = _unescape(norm_chart)
            fenced_new_code = f"```mermaid\n{new_code}\n```"

            if norm_chart in norm_old:
                new_content = norm_old.replace(norm_chart, fenced_new_code, 1)
            elif norm_chart.strip() in norm_old:
                new_content = norm_old.replace(norm_chart.strip(), fenced_new_code, 1)
            else:
                # Fallback: strip outer fences from request.chart_code and find the inner content
                inner = _re.sub(r"^```(mermaid)?\n", "", norm_chart, flags=_re.IGNORECASE)
                inner = _re.sub(r"\n```$", "", inner).strip()
                if inner and inner in norm_old:
                    # Find the surrounding fences
                    pattern = r"```(?:mermaid)?\n[\s\S]*?" + _re.escape(inner) + r"[\s\S]*?\n```"
                    match = _re.search(pattern, norm_old, _re.IGNORECASE)
                    if match:
                        new_content = norm_old[:match.start()] + fenced_new_code + norm_old[match.end():]
                    else:
                        raise RuntimeError(f"내부 매칭 실패. inner({len(inner)}): {repr(inner)[:50]}")
                else:
                    raise RuntimeError(f"원본 다이어그램 불일치. chart({len(norm_chart)}): {repr(norm_chart)[:50]}..., inner({len(inner)}): {repr(inner)[:50]}...")

            page.content = new_content
            cache_data.generated_pages[request.page_id] = page

            save_req = WikiCacheRequest(
                repo=cache_data.repo or RepoInfo(
                    owner=request.owner, repo=request.repo,
                    type=request.repo_type,
                ),
                language=request.language,
                wiki_structure=cache_data.wiki_structure,
                generated_pages=cache_data.generated_pages,
                provider=request.provider,
                model=request.model or "local",
            )
            await save_wiki_cache(save_req)

            await emit_task_event(
                job_id, "complete",
                "다이어그램 수정 완료 — 페이지를 새로고침하세요.",
                phase="fix_diagram",
                data={"page_id": request.page_id},
            )
            logger.info(f"fix_diagram: page '{request.page_id}' updated successfully (job={job_id})")

        except Exception as exc:
            logger.error(f"fix_diagram background error: {exc}")
            await emit_task_event(
                job_id, "error",
                f"다이어그램 수정 실패: {exc}",
                phase="fix_diagram",
            )

    asyncio.create_task(_bg_fix())
    return JSONResponse({"status": "queued", "job_id": job_id}, status_code=202)



# --- Wiki RAG (P3): semantic Q&A grounded in the generated wiki documents ---

class WikiAskPageInput(BaseModel):
    id: str
    title: str
    content: str = ""


class WikiAskRequest(BaseModel):
    wiki_pages: List[WikiAskPageInput] = Field(..., description="Generated wiki pages to ground on")
    question: str = Field(..., description="User question")
    wiki_title: Optional[str] = Field("Wiki", description="Wiki title for the system prompt")
    history: Optional[List[Dict[str, str]]] = Field(None, description="Prior {role, content} turns")
    provider: str = Field("google", description="Model provider (google, openai, openrouter)")
    model: Optional[str] = Field(None, description="Model name")
    language: Optional[str] = Field("ko", description="Answer language")
    mode: Optional[str] = Field("cli", description="'cli' or 'api'")
    api_key: Optional[str] = Field(None, description="Optional API key override")
    stream_id: Optional[str] = Field(None, description="Optional task stream id")
    top_k: Optional[int] = Field(None, description="Retrieval top-k override")


def _provider_to_cli(provider: str) -> str:
    if provider == "google":
        return "gemini"
    if provider == "anthropic":
        return "claude"
    if provider == "antigravity":
        return "antigravity"
    return "codex"


@app.post("/wiki/ask/stream")
async def wiki_ask_stream(request: WikiAskRequest):
    """Semantic retrieval over the wiki, then delegate generation to the chat stream path."""
    from api.wiki_rag import retrieve_wiki_context

    pages = [p.model_dump() for p in request.wiki_pages]
    try:
        context, _cited = retrieve_wiki_context(pages, request.question, request.top_k)
    except Exception as e:
        logger.error(f"Wiki RAG retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"위키 임베딩/검색 실패: {e}")

    lang_line = (
        "Answer in English."
        if request.language == "en"
        else "Answer in Korean (한국어); keep technical terms and identifiers in English."
    )
    hist = ""
    if request.history:
        hist = (
            "\n## Previous conversation\n"
            + "\n".join(f"{h.get('role', 'user')}: {h.get('content', '')}" for h in request.history)
            + "\n"
        )

    if not context:
        prompt = (
            f"There is no indexable wiki content to answer from. Tell the user you could not find "
            f"relevant documentation. {lang_line}\n\n## Question\n{request.question}"
        )
    else:
        prompt = (
            f'You are a documentation assistant for the wiki titled "{request.wiki_title}".\n'
            f"Answer the question using ONLY the wiki excerpts below. If the answer is not present, "
            f"clearly say you could not find it in the documentation — never invent facts.\n"
            f"When you reference a wiki page, cite it inline as [[Exact Page Title]].\n"
            f"{lang_line}\n"
            f"\n## Relevant wiki excerpts\n{context}\n{hist}\n## Question\n{request.question}"
        )

    chat_req = ChatCompletionRequest(
        repo_url=request.wiki_title or "wiki",
        type="local",
        messages=[{"role": "user", "content": prompt}],
        model=request.model,
        provider=request.provider,
        language=request.language or "ko",
        skip_rag=True,
        is_wiki_generation=True,  # blank backend system prompt → grounding fully controlled here
        stream_id=request.stream_id,
        **(
            {"use_cli": True, "cli_tool": _provider_to_cli(request.provider)}
            if (request.mode or "cli") == "cli"
            else {}
        ),
        **({"api_key": request.api_key} if request.api_key else {}),
    )
    return await chat_completions_stream(chat_req)


@app.get("/wiki/rag/health")
async def wiki_rag_health():
    """Report whether semantic wiki search (Ollama embeddings) is usable, for the UI guard."""
    from api.wiki_rag import WIKI_EMBEDDER_TYPE
    if WIKI_EMBEDDER_TYPE == "none":
        return {"available": True, "model": "none", "embedder": "none"}
        
    from api.config import configs

    model = (
        configs.get("embedder_ollama", {})
        .get("model_kwargs", {})
        .get("model", "nomic-embed-text")
    )
    available = False
    try:
        from api.ollama_patch import check_ollama_model_exists
        available = bool(check_ollama_model_exists(model))
    except Exception as e:
        logger.info(f"Wiki RAG health: Ollama unavailable ({e})")
    return {"available": available, "model": model, "embedder": "ollama"}

# --- Wiki Cache Helper Functions ---

WIKI_CACHE_DIR = os.path.join(get_adalflow_default_root_path(), "wikicache")
os.makedirs(WIKI_CACHE_DIR, exist_ok=True)

def get_wiki_cache_path(owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None) -> str:
    """Generates the file path for a given wiki cache."""
    model_str = f"_{model}" if model else ""
    # Safe model string replacement for filenames if needed, though most characters are safe except slashes.
    model_str = model_str.replace("/", "-")
    filename = f"localwiki_cache_{repo_type}_{owner}_{repo}_{language}{model_str}.json"
    return os.path.join(WIKI_CACHE_DIR, filename)

async def read_wiki_cache(owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None) -> Optional[WikiCacheData]:
    """Reads wiki cache data from the file system."""
    cache_path = get_wiki_cache_path(owner, repo, repo_type, language, model)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return WikiCacheData(**data)
        except Exception as e:
            logger.error(f"Error reading wiki cache from {cache_path}: {e}")
            return None
    return None

async def save_wiki_cache(data: WikiCacheRequest) -> bool:
    """Saves wiki cache data to the file system."""
    cache_path = get_wiki_cache_path(data.repo.owner, data.repo.repo, data.repo.type, data.language, data.model)
    logger.info(f"Attempting to save wiki cache. Path: {cache_path}")
    try:
        payload = WikiCacheData(
            wiki_structure=data.wiki_structure,
            generated_pages=data.generated_pages,
            repo=data.repo,
            provider=data.provider,
            model=data.model,
            language=data.language
        )
        try:
            payload_json = payload.model_dump_json()
            payload_size = len(payload_json.encode('utf-8'))
            logger.info(f"Payload prepared for caching. Size: {payload_size} bytes.")
        except Exception as ser_e:
            logger.warning(f"Could not serialize payload for size logging: {ser_e}")

        logger.info(f"Writing cache file to: {cache_path}")
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(payload.model_dump(), f, indent=2)
        logger.info(f"Wiki cache successfully saved to {cache_path}")

        # SQLite 레지스트리에 프로젝트 메타데이터 기록
        try:
            _lp = data.repo.localPath or data.repo.repoUrl or None
            project_db.upsert_project(
                data.repo.owner, data.repo.repo, data.repo.type, _lp
            )
            project_db.upsert_wiki_run(
                data.repo.owner, data.repo.repo,
                data.language, data.model or "local",
                provider=data.provider,
                cache_path=cache_path,
            )
        except Exception as _dbe:
            logger.warning(f"[db] wiki_run 기록 실패 (무시): {_dbe}")

        # Also write the generated pages to the wiki-out directory as .md files (separated by language)
        wiki_out_repo_name = f"{data.repo.repo}_{data.model}" if data.model else data.repo.repo
        wiki_out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wiki-out", wiki_out_repo_name, data.language)
        os.makedirs(wiki_out_dir, exist_ok=True)
        
        # Determine sections from wiki_structure
        section_map = {} # page_id -> section_id
        if data.wiki_structure and data.wiki_structure.sections:
            for sec in data.wiki_structure.sections:
                for page_id in sec.pages:
                    section_map[page_id] = sec.id
                    
        for page_id, page in data.generated_pages.items():
            section_id = section_map.get(page_id)
            if section_id:
                section_dir = os.path.join(wiki_out_dir, section_id)
                os.makedirs(section_dir, exist_ok=True)
                page_path = os.path.join(section_dir, f"{page_id}.md")
            else:
                page_path = os.path.join(wiki_out_dir, f"{page_id}.md")
                
            with open(page_path, 'w', encoding='utf-8') as f:
                f.write(page.content)
                
        logger.info(f"Wiki markdown files also saved to {wiki_out_dir}")

        return True
    except IOError as e:
        logger.error(f"IOError saving wiki cache to {cache_path}: {e.strerror} (errno: {e.errno})", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"Unexpected error saving wiki cache to {cache_path}: {e}", exc_info=True)
        return False

async def read_wiki_out_cache(repo: str, language: str, model: Optional[str] = None) -> Optional[WikiCacheData]:
    wiki_out_repo_name = f"{repo}_{model}" if model else repo
    wiki_out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wiki-out", wiki_out_repo_name, language)
    if not os.path.exists(wiki_out_dir):
        return None
        
    pages = []
    generated_pages = {}
    sections = []
    rootSections = []
    
    for item in os.listdir(wiki_out_dir):
        item_path = os.path.join(wiki_out_dir, item)
        if os.path.isdir(item_path) and not item.startswith("."):
            rootSections.append(item)
            section_pages = []
            for f in os.listdir(item_path):
                if f.endswith(".md"):
                    page_id = f.replace(".md", "")
                    section_pages.append(page_id)
                    with open(os.path.join(item_path, f), "r", encoding="utf-8") as fd:
                        content = fd.read()
                    
                    page_obj = WikiPage(
                        id=page_id,
                        title=page_id,
                        content=content,
                        filePaths=[],
                        importance="medium",
                        relatedPages=[]
                    )
                    pages.append(page_obj)
                    generated_pages[page_id] = page_obj
                    
            sections.append(WikiSection(
                id=item,
                title=item,
                pages=section_pages
            ))
            
    wiki_structure = WikiStructureModel(
        id=repo,
        title=f"{repo} Wiki",
        description="Generated from wiki-out folder",
        pages=pages,
        sections=sections,
        rootSections=rootSections
    )
    
    # wiki-out 디렉토리를 소스 경로로 노출하지 않음 (simple_chat.py가 오인 방지)
    # 실제 localPath는 SQLite DB 또는 wikicache JSON에서 별도로 조회
    return WikiCacheData(
        wiki_structure=wiki_structure,
        generated_pages=generated_pages,
        repo=RepoInfo(
            owner="local",
            repo=repo,
            type="local",
            localPath=None,
            repoUrl=None
        ),
        provider="local",
        model="local"
    )

# --- Wiki Cache API Endpoints ---

@app.get("/api/wiki_cache", response_model=Optional[WikiCacheData])
async def get_cached_wiki(
    owner: str = Query(..., description="Repository owner"),
    repo: str = Query(..., description="Repository name"),
    repo_type: str = Query(..., description="Repository type (e.g., github, gitlab)"),
    language: str = Query(..., description="Language of the wiki content"),
    model: Optional[str] = Query(None, description="Optional model to load specific cache")
):
    """
    Retrieves cached wiki data (structure and generated pages) for a repository.
    """
    # Language validation
    supported_langs = configs["lang_config"]["supported_languages"]
    if not supported_langs.__contains__(language):
        language = configs["lang_config"]["default"]

    logger.info(f"Fetching cached wiki for {owner}/{repo} ({repo_type}) in {language} with model {model}")
    
    # Try with explicit model if provided
    cache_data = await read_wiki_cache(owner, repo, repo_type, language, model)
    if not cache_data and model:
        # Fallback to no-model path for older caches
        cache_data = await read_wiki_cache(owner, repo, repo_type, language)

    if not cache_data:
        logger.info("Cache not found in wikicache, checking wiki-out directory...")
        cache_data = await read_wiki_out_cache(repo, language, model)
        if not cache_data and model:
            cache_data = await read_wiki_out_cache(repo, language)
            
    if cache_data:
        return cache_data
        
    logger.info(f"Wiki cache not found for {owner}/{repo} ({repo_type}), lang: {language}")
    return None

def _git_remote_to_web_url(remote: str) -> Optional[str]:
    """Convert a git remote (SSH or HTTPS) into a browsable web base URL.

    git@host:org/repo.git        -> https://host/org/repo
    ssh://git@host:22/org/repo.git -> https://host/org/repo
    https://host/org/repo.git    -> https://host/org/repo
    """
    import re
    if not remote:
        return None
    remote = remote.strip()
    remote = re.sub(r"\.git$", "", remote)
    # scp-like syntax: git@host:org/repo
    m = re.match(r"^[\w.+-]+@([^:/]+):(.+)$", remote)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    # ssh://[user@]host[:port]/org/repo
    m = re.match(r"^ssh://(?:[\w.+-]+@)?([^/:]+)(?::\d+)?/(.+)$", remote)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    # http(s)://host/org/repo
    if remote.startswith("http://") or remote.startswith("https://"):
        return remote
    return None


def _scan_git_roots(base_path: str, max_depth: int = 3) -> List[Dict[str, Any]]:
    """Find every git repository root under base_path (the base itself + nested
    subdirectories that contain a .git). For each, resolve the origin remote's
    web URL and the default branch. Returns entries keyed by their POSIX path
    relative to base_path ("" for the base itself)."""
    import subprocess

    base_path = os.path.abspath(base_path)
    roots: List[Dict[str, Any]] = []
    skip_dirs = {"node_modules", ".trash", "dist", "build", "target", "out", ".next", "vendor"}

    def _git(args: List[str], cwd: str) -> str:
        try:
            return subprocess.run(
                ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10
            ).stdout.strip()
        except Exception:
            return ""

    def _record(repo_dir: str) -> None:
        rel = os.path.relpath(repo_dir, base_path)
        prefix = "" if rel == "." else rel.replace(os.sep, "/")
        remote = _git(["remote", "get-url", "origin"], repo_dir)
        web_url = _git_remote_to_web_url(remote)
        head = _git(["rev-parse", "--abbrev-ref", "origin/HEAD"], repo_dir)
        branch = head.split("/")[-1] if head else (_git(["rev-parse", "--abbrev-ref", "HEAD"], repo_dir) or "main")
        roots.append({
            "prefix": prefix,
            "name": os.path.basename(repo_dir),
            "remote": remote or None,
            "webUrl": web_url,
            "branch": branch or "main",
        })

    def _walk(current: str, depth: int) -> None:
        if os.path.exists(os.path.join(current, ".git")):
            _record(current)
            # A repo root's own working tree is one git repo; don't descend
            # into it looking for more (submodules aside, which we ignore).
            return
        if depth >= max_depth:
            return
        try:
            entries = sorted(os.scandir(current), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if entry.is_dir(follow_symlinks=False) and not entry.name.startswith(".") \
               and entry.name not in skip_dirs:
                _walk(entry.path, depth + 1)

    _walk(base_path, 0)
    return roots


@app.get("/api/git_roots")
async def get_git_roots(
    owner: str = Query(...),
    repo: str = Query(...),
    repo_type: str = Query("local"),
    language: str = Query("en"),
    model: Optional[str] = Query(None),
):
    """Resolve the local source path for a wiki and return the git repository
    roots under it (each subproject with its own .git), so the frontend can
    build GitHub links rooted at the correct individual repository rather than
    the bundling parent directory."""
    cache_data = await read_wiki_cache(owner, repo, repo_type, language, model)
    if cache_data is None and model:
        cache_data = await read_wiki_cache(owner, repo, repo_type, language)

    local_path = None
    if cache_data and cache_data.repo:
        local_path = cache_data.repo.localPath or cache_data.repo.repoUrl

    if not local_path or not os.path.isdir(local_path):
        return {"localPath": local_path, "roots": []}

    roots = await asyncio.to_thread(_scan_git_roots, local_path)
    return {"localPath": local_path, "roots": roots}


@app.post("/api/wiki_cache")
async def store_wiki_cache(request_data: WikiCacheRequest):
    """
    Stores generated wiki data (structure and pages) to the server-side cache.
    """
    # Language validation
    supported_langs = configs["lang_config"]["supported_languages"]

    if not supported_langs.__contains__(request_data.language):
        request_data.language = configs["lang_config"]["default"]

    logger.info(f"Attempting to save wiki cache for {request_data.repo.owner}/{request_data.repo.repo} ({request_data.repo.type}), lang: {request_data.language}")
    success = await save_wiki_cache(request_data)
    if success:
        return {"message": "Wiki cache saved successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save wiki cache")

def cleanup_trash():
    """Delete files and folders in .trash directories older than 3 days."""
    try:
        current_time = time.time()
        ttl_seconds = 3 * 24 * 3600
        
        trash_dirs = [
            os.path.join(WIKI_CACHE_DIR, ".trash"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wiki-out", ".trash")
        ]
        
        for trash_dir in trash_dirs:
            if not os.path.exists(trash_dir):
                continue
                
            for name in os.listdir(trash_dir):
                path = os.path.join(trash_dir, name)
                if current_time - os.path.getmtime(path) > ttl_seconds:
                    if os.path.isdir(path):
                        shutil.rmtree(path, ignore_errors=True)
                    else:
                        try:
                            os.remove(path)
                        except OSError:
                            pass
                    logger.info(f"Deleted expired trash item: {path}")
    except Exception as e:
        logger.error(f"Error during cleanup_trash: {e}")


@app.delete("/api/wiki_cache")
async def delete_wiki_cache(
    owner: str = Query(..., description="Repository owner"),
    repo: str = Query(..., description="Repository name"),
    repo_type: str = Query(..., description="Repository type (e.g., github, gitlab)"),
    language: str = Query(..., description="Language of the wiki content"),
    authorization_code: Optional[str] = Query(None, description="Authorization code")
):
    """
    Moves wiki cache and generated wiki files to .trash directory with a 3-day TTL.
    """
    # Language validation
    supported_langs = configs["lang_config"]["supported_languages"]
    if not supported_langs.__contains__(language):
        language = configs["lang_config"]["default"]

    if WIKI_AUTH_MODE:
        logger.info("check the authorization code")
        if not authorization_code or WIKI_AUTH_CODE != authorization_code:
            raise HTTPException(status_code=401, detail="Authorization code is invalid")

    logger.info(f"Attempting to soft delete wiki files for {owner}/{repo} ({repo_type}), lang: {language}")
    cache_path = get_wiki_cache_path(owner, repo, repo_type, language)
    
    # Run TTL cleanup
    cleanup_trash()

    deleted_items = []
    timestamp = int(time.time())
    
    try:
        # Move cache file to trash
        if os.path.exists(cache_path):
            cache_trash_dir = os.path.join(WIKI_CACHE_DIR, ".trash")
            os.makedirs(cache_trash_dir, exist_ok=True)
            new_name = f"{os.path.basename(cache_path)}_{timestamp}.bak"
            shutil.move(cache_path, os.path.join(cache_trash_dir, new_name))
            deleted_items.append("cache_file")
            
        # Move wiki-out directory to trash
        wiki_out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wiki-out", repo, language)
        if os.path.exists(wiki_out_dir):
            wiki_trash_dir = os.path.join(os.path.dirname(os.path.dirname(wiki_out_dir)), ".trash")
            os.makedirs(wiki_trash_dir, exist_ok=True)
            new_name = f"{repo}_{language}_{timestamp}"
            shutil.move(wiki_out_dir, os.path.join(wiki_trash_dir, new_name))
            deleted_items.append("wiki_out_dir")
            
            # Clean up repo directory if empty
            repo_dir = os.path.dirname(wiki_out_dir)
            if not os.listdir(repo_dir):
                shutil.rmtree(repo_dir, ignore_errors=True)
            
        if not deleted_items:
            # If we didn't find anything to delete, that's okay, maybe it was already deleted
            return {"message": "Wiki files not found or already deleted"}
            
        logger.info(f"Successfully moved to trash: {deleted_items} for {owner}/{repo}")
        return {"message": f"Wiki files for {owner}/{repo} ({language}) moved to trash successfully"}
        
    except Exception as e:
        logger.error(f"Error moving wiki files to trash: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete wiki files: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint for Docker and monitoring"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "localwiki-api"
    }

@app.get("/check-connection")
async def check_connection(
    mode: str = Query("cli", description="'cli' or 'api'"),
    url: Optional[str] = Query(None, description="litellm base URL for CLI mode"),
    provider: Optional[str] = Query(None, description="Provider for API mode"),
    api_key: Optional[str] = Query(None, description="API key for API mode"),
):
    """Validate a litellm proxy URL (CLI mode) or API key (API mode) before generation starts."""
    import httpx
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
        # API mode: just check the key looks valid (real validation would cost tokens)
        if not api_key or len(api_key.strip()) < 10:
            return JSONResponse({"ok": False, "message": "API 키가 너무 짧습니다."})
        return {"ok": True, "message": "✅ API 키가 등록되었습니다. 생성 시 실제 검증됩니다."}

@app.get("/")
async def root():
    """Root endpoint to check if the API is running and list available endpoints dynamically."""
    # Collect routes dynamically from the FastAPI app
    endpoints = {}
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            # Skip docs and static routes
            if route.path in ["/openapi.json", "/docs", "/redoc", "/favicon.ico"]:
                continue
            # Group endpoints by first path segment
            path_parts = route.path.strip("/").split("/")
            group = path_parts[0].capitalize() if path_parts[0] else "Root"
            method_list = list(route.methods - {"HEAD", "OPTIONS"})
            for method in method_list:
                endpoints.setdefault(group, []).append(f"{method} {route.path}")

    # Optionally, sort endpoints for readability
    for group in endpoints:
        endpoints[group].sort()

    return {
        "message": "Welcome to Streaming API",
        "version": "1.0.0",
        "endpoints": endpoints
    }

# --- Processed Projects Endpoint ---
@app.get("/api/processed_projects", response_model=List[ProcessedProjectEntry])
async def get_processed_projects():
    """
    SQLite DB에서 처리된 프로젝트 목록을 반환합니다.
    DB가 비어있을 경우 기존 JSON 캐시 파일 스캔으로 폴백합니다.
    """
    try:
        # ── 1차: SQLite DB에서 조회 ────────────────────────────────────────────
        rows = await asyncio.to_thread(project_db.list_projects)
        if rows:
            # wiki_runs 기준으로 (project_id, language, model) 중복 제거
            seen = set()
            project_entries: List[ProcessedProjectEntry] = []
            for r in rows:
                key = (r["id"], r.get("language", ""), r.get("model", ""))
                if key in seen:
                    continue
                seen.add(key)
                project_entries.append(
                    ProcessedProjectEntry(
                        id=f"{r['id']}_{r.get('language', '')}_{r.get('model', '')}",
                        owner=r["owner"],
                        repo=r["repo"],
                        name=f"{r['owner']}/{r['repo']}",
                        repo_type=r.get("repo_type", "local"),
                        submittedAt=(r.get("generated_at") or r.get("updated_at") or 0) * 1000,
                        language=r.get("language") or "ko",
                        model=r.get("model") or None,
                    )
                )
            project_entries.sort(key=lambda p: p.submittedAt, reverse=True)
            logger.info(f"Found {len(project_entries)} processed project entries (from DB).")
            return project_entries

        # ── 2차 폴백: JSON 캐시 파일 스캔 (DB가 비어있는 경우) ──────────────
        logger.info(f"DB 비어있음 — JSON 캐시 스캔으로 폴백: {WIKI_CACHE_DIR}")
        if not os.path.exists(WIKI_CACHE_DIR):
            return []

        project_entries = []
        existing_keys: set = set()
        filenames = await asyncio.to_thread(os.listdir, WIKI_CACHE_DIR)

        for filename in filenames:
            if not (filename.startswith("localwiki_cache_") and filename.endswith(".json")):
                continue
            file_path = os.path.join(WIKI_CACHE_DIR, filename)
            try:
                stats = await asyncio.to_thread(os.stat, file_path)
                parts = filename.replace("localwiki_cache_", "").replace(".json", "").split("_")
                if len(parts) < 4:
                    continue
                repo_type = parts[0]
                owner = parts[1]
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    language = data.get("language")
                    model = data.get("model")
                    repo_obj = data.get("repo", {})
                    repo = repo_obj.get("repo") if isinstance(repo_obj, dict) and "repo" in repo_obj else "_".join(parts[2:-1])
                    if not language:
                        language = parts[-1]
                except Exception:
                    repo = "_".join(parts[2:-1])
                    language = parts[-1]
                    model = None

                project_entries.append(
                    ProcessedProjectEntry(
                        id=filename,
                        owner=owner,
                        repo=repo,
                        name=f"{owner}/{repo}",
                        repo_type=repo_type,
                        submittedAt=int(stats.st_mtime * 1000),
                        language=language or "ko",
                        model=model,
                    )
                )
                existing_keys.add((repo, language or "ko"))
                if model:
                    existing_keys.add((f"{repo}_{model}", language or "ko"))
            except Exception as e:
                logger.error(f"Error processing file {file_path}: {e}")

        project_entries.sort(key=lambda p: p.submittedAt, reverse=True)
        logger.info(f"Found {len(project_entries)} processed project entries (from JSON cache).")
        return project_entries

    except Exception as e:
        logger.error(f"Error listing processed projects: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list processed projects.")
