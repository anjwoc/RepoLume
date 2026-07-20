"""Diagram fix endpoint — fire-and-forget background task."""
import asyncio
import json
import logging
import os
import re as _re
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.config import configs
from api.routes.cache import get_wiki_cache_path, read_wiki_cache, save_wiki_cache
from api.routes.models import RepoInfo, WikiCacheRequest
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)
router = APIRouter()


class FixDiagramRequest(BaseModel):
    owner: str
    repo: str
    repo_type: str = "local"
    language: str = "ko"
    model: Optional[str] = None
    page_id: str
    chart_code: str
    custom_instruction: Optional[str] = None
    provider: str = "google"
    use_cli: bool = True
    cli_tool: str = "gemini"


@router.post("/api/fix_diagram", status_code=202)
async def fix_diagram(request: FixDiagramRequest):
    from api.agent_runner import AgentRegistry

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

            _supported = configs["lang_config"]["supported_languages"]
            _language = request.language if request.language in _supported else configs["lang_config"]["default"]

            cwd = "."
            if request.repo_type == "local":
                try:
                    cache_path = get_wiki_cache_path(
                        request.owner, request.repo, request.repo_type,
                        _language, request.model,
                    )
                    if not os.path.exists(cache_path):
                        cache_path = get_wiki_cache_path(
                            request.owner, request.repo, request.repo_type,
                            _language,
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

            agent_name = request.cli_tool if request.use_cli else "gemini"
            if agent_name == "gemini" and (request.model or "").startswith("agy-"):
                agent_name = "antigravity"
            registry = AgentRegistry()
            runner = registry.get(agent_name)

            result = await runner.run_collect(
                fix_prompt, cwd=cwd, model=request.model or "", timeout=180,
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

            cache_data = await read_wiki_cache(
                request.owner, request.repo, request.repo_type,
                _language, request.model,
            )
            if cache_data is None:
                cache_data = await read_wiki_cache(
                    request.owner, request.repo, request.repo_type, _language,
                )
            if cache_data is None:
                raise RuntimeError("캐시를 찾을 수 없습니다.")

            page = cache_data.generated_pages.get(request.page_id)
            if page is None:
                raise RuntimeError(f"페이지 '{request.page_id}'를 캐시에서 찾을 수 없습니다.")

            old_content = page.content
            norm_old = old_content.replace('\r\n', '\n')
            norm_chart = request.chart_code.replace('\r\n', '\n')

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
                inner = _re.sub(r"^```(mermaid)?\n", "", norm_chart, flags=_re.IGNORECASE)
                inner = _re.sub(r"\n```$", "", inner).strip()
                if inner and inner in norm_old:
                    pattern = r"```(?:mermaid)?\n[\s\S]*?" + _re.escape(inner) + r"[\s\S]*?\n```"
                    m = _re.search(pattern, norm_old, _re.IGNORECASE)
                    if m:
                        new_content = norm_old[:m.start()] + fenced_new_code + norm_old[m.end():]
                    else:
                        raise RuntimeError(f"내부 매칭 실패. inner({len(inner)}): {repr(inner)[:50]}")
                else:
                    raise RuntimeError(
                        f"원본 다이어그램 불일치. chart({len(norm_chart)}): {repr(norm_chart)[:50]}..., "
                        f"inner({len(inner)}): {repr(inner)[:50]}..."
                    )

            page.content = new_content
            cache_data.generated_pages[request.page_id] = page

            save_req = WikiCacheRequest(
                repo=cache_data.repo or RepoInfo(
                    owner=request.owner, repo=request.repo, type=request.repo_type,
                ),
                language=_language,
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
            logger.info(f"fix_diagram: page '{request.page_id}' updated (job={job_id})")

        except Exception as exc:
            logger.error(f"fix_diagram background error: {exc}")
            await emit_task_event(
                job_id, "error",
                f"다이어그램 수정 실패: {exc}",
                phase="fix_diagram",
            )

    asyncio.create_task(_bg_fix())
    return JSONResponse({"status": "queued", "job_id": job_id}, status_code=202)
