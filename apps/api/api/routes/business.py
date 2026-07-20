"""Business analysis endpoint — multi-repo data flow / workflow / impact pages."""
import asyncio
import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeBusinessRequest(BaseModel):
    repo_url: Optional[str] = None
    repo_urls: Optional[List[str]] = None
    language: str = "ko"
    provider: Optional[str] = None
    model: Optional[str] = None
    mode: Optional[Literal["cli", "api"]] = "cli"
    cli_tool: Optional[str] = None
    api_key: Optional[str] = None


class MultiRepoBusinessContext:
    """Minimal adapter to present multiple LocalRepo objects as one system."""

    def __init__(self, repos: List[Any]) -> None:
        self.repos = repos
        self.path = repos[0].path

    def file_tree(self, max_depth: int = 6) -> str:
        parts = [
            f"## Repository: {r.path.name}\nRoot: {r.path}\n{r.file_tree(max_depth=max_depth)}"
            for r in self.repos
        ]
        return "\n\n".join(parts)

    def readme(self) -> str:
        parts = [
            f"## Repository: {r.path.name}\nRoot: {r.path}\n\n{r.readme() or '(no README found)'}"
            for r in self.repos
        ]
        return "\n\n---\n\n".join(parts)

    def read_file(self, relative_path: str) -> str:
        for repo in self.repos:
            content = repo.read_file(relative_path)
            if content:
                return content
        return ""


def _business_repo_paths(request: AnalyzeBusinessRequest) -> List[str]:
    raw = request.repo_urls if request.repo_urls else ([request.repo_url] if request.repo_url else [])
    seen: set[str] = set()
    paths: List[str] = []
    for p in raw:
        if p and p.strip() and p.strip() not in seen:
            seen.add(p.strip())
            paths.append(p.strip())
    return paths


def _business_provider_name(request: AnalyzeBusinessRequest) -> str:
    provider = (request.provider or "google").lower().strip()
    cli_tool = (request.cli_tool or "").lower().strip()
    mode = request.mode or "cli"
    if mode == "cli":
        agent = cli_tool or {
            "google": "gemini", "gemini": "gemini",
            "anthropic": "claude", "claude": "claude",
            "openai": "codex", "codex": "codex",
            "antigravity": "antigravity",
        }.get(provider, "codex")
        return f"{agent}-cli"
    return {"google": "gemini", "anthropic": "claude", "openai": "openai",
            "codex": "openai", "gemini": "gemini", "claude": "claude"}.get(provider, provider)


@router.post("/analyze_business")
async def analyze_business(request: AnalyzeBusinessRequest):
    """Run business analysis and return markdown pages."""
    try:
        from cli.pipeline.local_repo import LocalRepo
        from cli.providers import get_provider
        from cli.business import BusinessAnalyzer

        requested_paths = _business_repo_paths(request)
        if not requested_paths:
            raise HTTPException(status_code=400, detail="repo_url or repo_urls is required")

        repos: List[Any] = []
        warnings: List[str] = []
        for repo_path in requested_paths:
            try:
                repos.append(LocalRepo(repo_path))
            except Exception as exc:
                warnings.append(f"{repo_path}: {exc}")

        if not repos:
            raise HTTPException(
                status_code=404,
                detail={"message": "No valid repositories found", "warnings": warnings},
            )

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
        repo_name = (
            repos[0].path.name if len(repos) == 1
            else f"{repos[0].path.name} and {len(repos) - 1} related repos"
        )
        from cli.mcp.manager import MCPManager
        mcp_manager = MCPManager.from_config()

        analyzer = BusinessAnalyzer(provider, repo, repo_name=repo_name, mcp_manager=mcp_manager)
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
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Business analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
