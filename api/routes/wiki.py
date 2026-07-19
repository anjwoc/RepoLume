"""Wiki cache CRUD, processed projects, git roots, and wiki RAG endpoints."""
import asyncio
import json
import logging
import os
import re
import shutil
import time
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.config import configs, WIKI_AUTH_MODE, WIKI_AUTH_CODE
from api.routes.cache import (
    WIKI_CACHE_DIR, get_wiki_cache_path, read_wiki_cache, save_wiki_cache,
    read_wiki_out_cache, cleanup_trash,
)
from api.routes.models import (
    ProcessedProjectEntry, WikiCacheData, WikiCacheRequest, WikiPage,
)
from api.db.store import job_store, page_checkpoint_store, project_store, wiki_run_store

logger = logging.getLogger(__name__)
router = APIRouter()

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── SQLite cache helpers ───────────────────────────────────────────────────────

async def _sqlite_read(
    owner: str, repo: str, language: str, model: str
) -> Optional[WikiCacheData]:
    """Read wiki data from SQLite (new cache). Returns None if no run found."""
    from api.routes.models import RepoInfo, WikiPage, WikiStructureModel
    project_id = f"{owner}:{repo}:{language}"
    run = await asyncio.to_thread(wiki_run_store.get_run, project_id, model)
    if not run:
        return None
    run_id = run["id"]
    pages_rows = await asyncio.to_thread(wiki_run_store.get_all_pages, run_id)
    structure_row = await asyncio.to_thread(wiki_run_store.get_structure, run_id)
    if not pages_rows and not structure_row:
        return None
    project = await asyncio.to_thread(project_store.get, project_id)
    project_metadata = {}
    if project and project.get("metadata"):
        try:
            project_metadata = json.loads(project["metadata"])
        except (TypeError, json.JSONDecodeError):
            project_metadata = {}
    source_path = project_metadata.get("source_path")
    artifact_root = project_metadata.get("artifact_root")
    if not source_path or not artifact_root:
        legacy_paths = await read_wiki_cache(owner, repo, "local", language, model or None)
        if legacy_paths:
            source_path = source_path or legacy_paths.source_path
            artifact_root = artifact_root or legacy_paths.artifact_root
    generated_pages = {
        r["page_id"]: WikiPage(
            id=r["page_id"], title=r["title"], content=r["content"],
            filePaths=[], importance="medium", relatedPages=[],
        )
        for r in pages_rows
    }
    wiki_structure = None
    if structure_row:
        try:
            wiki_structure = WikiStructureModel(**json.loads(structure_row["structure_json"]))
        except Exception:
            pass
    return WikiCacheData(
        wiki_structure=wiki_structure,
        generated_pages=generated_pages,
        repo=RepoInfo(
            owner=owner,
            repo=repo,
            type="local",
            localPath=source_path,
            repoUrl=source_path,
        ),
        source_path=source_path,
        artifact_root=artifact_root,
        provider=None,
        model=model or None,
        language=language,
    )


async def _legacy_file_fallback(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str]
) -> Optional[WikiCacheData]:
    """Original 4-stage file-based fallback. Preserved unchanged for backward compat."""
    cache_data = await read_wiki_cache(owner, repo, repo_type, language, model)
    if not cache_data and model:
        cache_data = await read_wiki_cache(owner, repo, repo_type, language)
    if not cache_data:
        cache_data = await read_wiki_out_cache(repo, model)
    if not cache_data and model:
        cache_data = await read_wiki_out_cache(repo)
    return cache_data


# ── Wiki Cache CRUD ────────────────────────────────────────────────────────────

@router.get("/api/wiki_cache", response_model=Optional[WikiCacheData])
async def get_cached_wiki(
    owner: str = Query(...),
    repo: str = Query(...),
    repo_type: str = Query(...),
    language: str = Query(...),
    model: Optional[str] = Query(None),
):
    supported = configs["lang_config"]["supported_languages"]
    if language not in supported:
        language = configs["lang_config"]["default"]

    # 1. SQLite 우선
    cache_data = await _sqlite_read(owner, repo, language, model or "")
    if not cache_data:
        # 언어 크로스 폴백: ko↔en (FORCED_WIKI_LANGUAGE 변경으로 인한 캐시 미스 방지)
        other_lang = "en" if language == "ko" else "ko"
        cache_data = await _sqlite_read(owner, repo, other_lang, model or "")

    # 2. 기존 JSON/wiki-out 파일 폴백 (이전 캐시 하위 호환)
    if not cache_data:
        cache_data = await _legacy_file_fallback(owner, repo, repo_type, language, model)
    return cache_data


@router.post("/api/wiki_cache")
async def store_wiki_cache(request_data: WikiCacheRequest):
    supported = configs["lang_config"]["supported_languages"]
    if request_data.language not in supported:
        request_data.language = configs["lang_config"]["default"]
    success = await save_wiki_cache(request_data)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save wiki cache")
    return {"message": "Wiki cache saved successfully"}


@router.delete("/api/wiki_cache")
async def delete_wiki_cache(
    owner: str = Query(...),
    repo: str = Query(...),
    repo_type: str = Query(...),
    language: str = Query(...),
    model: Optional[str] = Query(None),
    authorization_code: Optional[str] = Query(None),
):
    supported = configs["lang_config"]["supported_languages"]
    if language not in supported:
        language = configs["lang_config"]["default"]

    if WIKI_AUTH_MODE and (not authorization_code or WIKI_AUTH_CODE != authorization_code):
        raise HTTPException(status_code=401, detail="Authorization code is invalid")

    cleanup_trash()
    deleted: list[str] = []
    timestamp = int(time.time())
    trash_dir = os.path.join(WIKI_CACHE_DIR, ".trash")

    # Delete cache file(s): try with model first, then without (covers both variants)
    candidates = [
        get_wiki_cache_path(owner, repo, repo_type, language, model if model else None),
    ]
    if model:
        candidates.append(get_wiki_cache_path(owner, repo, repo_type, language))

    try:
        for cache_path in candidates:
            if os.path.exists(cache_path):
                os.makedirs(trash_dir, exist_ok=True)
                shutil.move(cache_path, os.path.join(trash_dir, f"{os.path.basename(cache_path)}_{timestamp}.bak"))
                deleted.append("cache_file")

        # wiki-out is structured as wiki-out/{repo}_{model}/
        wiki_out_repo = f"{repo}_{model}" if model else repo
        wiki_out_dir = os.path.join(_PROJECT_ROOT, "wiki-out", wiki_out_repo)
        wiki_trash_dir = os.path.join(_PROJECT_ROOT, "wiki-out", ".trash")
        if os.path.exists(wiki_out_dir):
            os.makedirs(wiki_trash_dir, exist_ok=True)
            shutil.move(wiki_out_dir, os.path.join(wiki_trash_dir, f"{wiki_out_repo}_{timestamp}"))
            deleted.append("wiki_out_dir")

        # Delete DB records (project + jobs + checkpoints)
        project_id = f"{owner}_{repo}_{repo_type}_{language}"
        await asyncio.to_thread(project_store.delete, project_id)
        deleted.append("db_records")

        return {"message": f"Wiki for {owner}/{repo} ({language}) deleted successfully", "deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete wiki: {e}")


# ── Resumable Generation ──────────────────────────────────────────────────────

class StartJobRequest(BaseModel):
    job_id: str
    owner: str
    repo: str
    language: str = "ko"
    model: Optional[str] = None


@router.post("/api/wiki/start-job")
async def start_wiki_job(req: StartJobRequest):
    """Register a new wiki generation job in the DB."""
    project_id = f"{req.owner}:{req.repo}:{req.language}"
    await asyncio.to_thread(
        project_store.upsert, project_id, req.owner, req.repo, req.language, req.model
    )
    await asyncio.to_thread(job_store.create, req.job_id, project_id)
    await asyncio.to_thread(job_store.start, req.job_id)
    return {"job_id": req.job_id, "project_id": project_id}


class CheckpointRequest(BaseModel):
    job_id: str
    page_id: str
    page_title: str
    content: str = ""


@router.post("/api/wiki/checkpoint")
async def save_page_checkpoint(req: CheckpointRequest):
    """Mark a wiki page as successfully generated (idempotent). Stores content for resume."""
    await asyncio.to_thread(
        page_checkpoint_store.mark_completed, req.job_id, req.page_id, req.page_title, req.content
    )
    await asyncio.to_thread(
        job_store.update_page_counts, req.job_id, None, 1, 0
    )
    return {"ok": True}


class InterruptJobRequest(BaseModel):
    job_id: str
    error: str = "rate_limit"


@router.post("/api/wiki/interrupt-job")
async def interrupt_wiki_job(req: InterruptJobRequest):
    """Mark a job as interrupted (rate limit / quota exhausted) — resumable."""
    await asyncio.to_thread(job_store.interrupt, req.job_id, req.error)
    return {"ok": True}


@router.delete("/api/wiki/interrupted-job")
async def dismiss_interrupted_job(job_id: str = Query(...)):
    """Dismiss (delete) an interrupted job entry from the resumable list."""
    await asyncio.to_thread(job_store.dismiss, job_id)
    return {"ok": True}


class ResumeRequest(BaseModel):
    owner: str
    repo: str
    repo_type: str = "local"
    language: str = "ko"
    model: Optional[str] = None
    parent_job_id: str


@router.post("/api/wiki/resume")
async def resume_wiki_generation(req: ResumeRequest):
    """
    Resume a previously interrupted wiki generation.
    Returns: new_job_id, stream_id (same as new_job_id), completed_page_ids, wiki_structure.
    """
    # Verify parent job exists and is interrupted
    parent = await asyncio.to_thread(job_store.get, req.parent_job_id)
    if not parent:
        raise HTTPException(status_code=404, detail=f"Job '{req.parent_job_id}' not found")
    if parent["status"] not in ("interrupted", "failed"):
        raise HTTPException(status_code=400, detail=f"Job is not resumable (status={parent['status']})")

    # Get completed pages with content from checkpoints (primary source for recovery)
    checkpoint_pages = await asyncio.to_thread(
        page_checkpoint_store.get_completed_with_content, req.parent_job_id
    )
    completed_ids = [cp["page_id"] for cp in checkpoint_pages]

    # Load wiki_structure from wikicache
    cache_data = await read_wiki_cache(req.owner, req.repo, req.repo_type, req.language, req.model)
    if not cache_data and req.model:
        cache_data = await read_wiki_cache(req.owner, req.repo, req.repo_type, req.language)
    if not cache_data:
        raise HTTPException(status_code=404, detail="Wiki cache not found — cannot resume without structure")

    # Merge: checkpoint content first (always present), wikicache overrides if richer
    merged_pages: dict = {
        cp["page_id"]: {"id": cp["page_id"], "title": cp["page_title"], "content": cp["content"]}
        for cp in checkpoint_pages
        if cp.get("content")
    }
    for pid, page in (cache_data.generated_pages or {}).items():
        if pid in completed_ids:
            merged_pages[pid] = page  # wikicache takes precedence when available

    # Create new resume job
    project_id = parent.get("project_id")
    new_job_id = await asyncio.to_thread(
        job_store.create_resume, project_id, req.parent_job_id
    )
    await asyncio.to_thread(job_store.start, new_job_id)

    # Carry forward page_total from parent
    if parent.get("page_total"):
        await asyncio.to_thread(
            job_store.update_page_counts, new_job_id, parent["page_total"], len(completed_ids), 0
        )

    return {
        "new_job_id": new_job_id,
        "stream_id": new_job_id,
        "completed_page_ids": completed_ids,
        "wiki_structure": cache_data.wiki_structure,
        "generated_pages": merged_pages,
    }


@router.get("/api/wiki/interrupted-projects")
async def get_interrupted_projects():
    """Return all jobs with status='interrupted', joined with project info."""
    from api.db.store import _conn
    def query():
        with _conn() as con:
            rows = con.execute(
                """
                SELECT j.id as job_id, j.project_id, j.page_done, j.page_total,
                       j.started_at, j.error,
                       p.owner, p.repo, p.language, p.model
                FROM jobs j
                LEFT JOIN projects p ON p.id = j.project_id
                WHERE j.status = 'interrupted'
                ORDER BY j.started_at DESC
                LIMIT 50
                """
            ).fetchall()
            return [dict(r) for r in rows]
    return await asyncio.to_thread(query)


@router.get("/api/wiki/latest-job")
async def get_latest_job(
    owner: str = Query(...),
    repo: str = Query(...),
    language: str = Query("ko"),
):
    """Return the most recent job for a project (for status badges in project list)."""
    project_id = f"{owner}:{repo}:{language}"
    jobs = await asyncio.to_thread(job_store.list, project_id, 1)
    if not jobs:
        return {"job": None}
    return {"job": jobs[0]}


@router.get("/api/wiki/cache-status")
async def get_cache_status(
    owner: str = Query(...),
    repo: str = Query(...),
    repo_type: str = Query("local"),
    language: str = Query("ko"),
    model: Optional[str] = Query(None),
):
    """
    Check whether a complete valid wiki cache exists.
    Returns one of three states:
      { exists: false }
      { exists: true, valid: true,  page_count, total_pages, generated_at }
      { exists: true, valid: false, page_count, total_pages, generated_at }
    """
    cache_path = get_wiki_cache_path(owner, repo, repo_type, language, model) if model else None

    # Try model-specific path first, then model-agnostic
    data = None
    used_path = None
    if cache_path and os.path.exists(cache_path):
        used_path = cache_path
    else:
        fallback = get_wiki_cache_path(owner, repo, repo_type, language)
        if os.path.exists(fallback):
            used_path = fallback

    if not used_path:
        return {"exists": False}

    try:
        with open(used_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"exists": True, "valid": False, "page_count": 0, "total_pages": 0, "generated_at": None}

    wiki_structure = data.get("wiki_structure") or {}
    generated_pages = data.get("generated_pages") or {}

    # Count expected pages from structure (sections is a list of {id, title, pages: [...]})
    total_pages = 0
    all_page_ids: list[str] = []
    for section in wiki_structure.get("sections") or []:
        if isinstance(section, dict):
            page_ids = section.get("pages") or []
            all_page_ids.extend(page_ids)
            total_pages += len(page_ids)

    # Count pages with non-empty content
    complete_count = sum(
        1 for pid in all_page_ids
        if pid in generated_pages and len((generated_pages[pid] or {}).get("content", "")) >= 50
    )

    generated_at = None
    try:
        generated_at = int(os.path.getmtime(used_path) * 1000)
    except Exception:
        pass

    valid = (
        bool(wiki_structure.get("sections"))
        and total_pages > 0
        and complete_count == total_pages
    )

    return {
        "exists": True,
        "valid": valid,
        "page_count": complete_count,
        "total_pages": total_pages,
        "generated_at": generated_at,
    }


# ── Processed Projects ────────────────────────────────────────────────────────

@router.get("/api/processed_projects", response_model=List[ProcessedProjectEntry])
async def get_processed_projects():
    entries: List[ProcessedProjectEntry] = []
    existing_keys: set[tuple[str, str]] = set()

    try:
        if not os.path.exists(WIKI_CACHE_DIR):
            return []

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
                    model = data.get("model")
                    repo_obj = data.get("repo", {})
                    repo = repo_obj.get("repo") if isinstance(repo_obj, dict) and "repo" in repo_obj else "_".join(parts[2:-1])
                    # Derive language from filename to avoid stale JSON content mismatch.
                    # Filename: localwiki_cache_{repo_type}_{owner}_{repo}_{language}[_{model}].json
                    base = filename.replace("localwiki_cache_", "").replace(".json", "")
                    fn_prefix = f"{repo_type}_{owner}_{repo}_"
                    language = None
                    if base.startswith(fn_prefix):
                        remainder = base[len(fn_prefix):]
                        if model and remainder.endswith(f"_{model}"):
                            language = remainder[:-(len(model) + 1)]
                        elif not model:
                            language = remainder
                    if not language:
                        language = data.get("language") or parts[-1]
                except Exception:
                    repo = "_".join(parts[2:-1])
                    language = parts[-1]
                    model = None

                entries.append(ProcessedProjectEntry(
                    id=filename, owner=owner, repo=repo, name=f"{owner}/{repo}",
                    repo_type=repo_type, submittedAt=int(stats.st_mtime * 1000),
                    language=language or "ko", model=model,
                ))
                existing_keys.add((repo, language or "ko"))
                # Also mark repo base name (without model suffix) so wiki-out dirs are deduped
                existing_keys.add((repo, "*"))
                if model:
                    existing_keys.add((f"{repo}_{model}", language or "ko"))
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")

        # Also scan wiki-out — skip anything already covered by a JSON cache entry.
        # wiki-out dirs are named "{repo}_{model}" or "{repo}".  We skip them when:
        #   1. exact (repo_dirname, lang) match, OR
        #   2. the base repo name (stripping the last "_<model>" segment) is in existing_keys
        wiki_out_dir = os.path.join(_PROJECT_ROOT, "wiki-out")
        if os.path.exists(wiki_out_dir):
            for repo_dirname in await asyncio.to_thread(os.listdir, wiki_out_dir):
                repo_path = os.path.join(wiki_out_dir, repo_dirname)
                if not os.path.isdir(repo_path) or repo_dirname.startswith("."):
                    continue
                # Derive base repo name: "vscode_agy-gemini-3.5-flash-high" → "vscode"
                # Strategy: strip the last underscore-separated segment if it looks like a model
                base_repo = repo_dirname.rsplit("_", 1)[0] if "_" in repo_dirname else repo_dirname
                for lang_dirname in await asyncio.to_thread(os.listdir, repo_path):
                    lang_path = os.path.join(repo_path, lang_dirname)
                    if not os.path.isdir(lang_path) or lang_dirname.startswith("."):
                        continue
                    # Skip if covered by a JSON cache entry (exact or base-repo wildcard)
                    if (
                        (repo_dirname, lang_dirname) in existing_keys
                        or (base_repo, lang_dirname) in existing_keys
                        or (base_repo, "*") in existing_keys
                    ):
                        continue
                    try:
                        stats = await asyncio.to_thread(os.stat, lang_path)
                        entries.append(ProcessedProjectEntry(
                            id=f"wiki-out-{repo_dirname}-{lang_dirname}",
                            owner="local", repo=repo_dirname, name=f"local/{repo_dirname}",
                            repo_type="local", submittedAt=int(stats.st_mtime * 1000),
                            language=lang_dirname,
                        ))
                    except Exception as e:
                        logger.error(f"Error processing wiki-out {lang_path}: {e}")

        entries.sort(key=lambda p: p.submittedAt, reverse=True)

        # Enrich with slug from DB (one bulk query)
        db_projects = await asyncio.to_thread(project_store.list_all)
        slug_by_repo: Dict[str, str] = {}
        for p in db_projects:
            if p.get("slug") and p.get("repo"):
                slug_by_repo.setdefault(p["repo"], p["slug"])
        for entry in entries:
            if not entry.slug:
                entry.slug = slug_by_repo.get(entry.repo) or entry.repo

        return entries
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to list processed projects")


@router.get("/api/wiki/project/{slug}")
async def get_project_by_slug(slug: str):
    """slug로 프로젝트 메타데이터 조회. 클린 URL(/wiki/{slug}) 진입점."""
    project = await asyncio.to_thread(project_store.get_by_slug, slug)
    if not project:
        raise HTTPException(status_code=404, detail=f"프로젝트 '{slug}'를 찾을 수 없습니다.")
    return {
        "slug": project.get("slug", slug),
        "project_key": project.get("project_key"),
        "owner": project["owner"],
        "repo": project["repo"],
        "repo_type": "local",
        "language": project["language"],
        "model": project.get("model"),
    }


@router.get("/api/projects/{slug}", response_model=Optional[WikiCacheData])
async def get_wiki_by_run_slug(slug: str):
    """wiki_runs.slug로 위키 전체 데이터 조회. /projects/{slug} URL 진입점."""
    run = await asyncio.to_thread(wiki_run_store.get_run_by_slug, slug)
    if not run:
        raise HTTPException(status_code=404, detail=f"위키 '{slug}'를 찾을 수 없습니다.")
    run_id = run["id"]
    pages_rows = await asyncio.to_thread(wiki_run_store.get_all_pages, run_id)
    structure_row = await asyncio.to_thread(wiki_run_store.get_structure, run_id)

    from api.routes.models import RepoInfo, WikiPage, WikiStructureModel
    # project_id = "owner:repo:language"
    parts = run["project_id"].split(":")
    owner = parts[0] if len(parts) > 0 else "local"
    repo = parts[1] if len(parts) > 1 else slug
    language = parts[2] if len(parts) > 2 else "ko"
    project = await asyncio.to_thread(project_store.get, run["project_id"])
    project_metadata = {}
    if project and project.get("metadata"):
        try:
            project_metadata = json.loads(project["metadata"])
        except (TypeError, json.JSONDecodeError):
            project_metadata = {}
    source_path = project_metadata.get("source_path")
    artifact_root = project_metadata.get("artifact_root")

    generated_pages = {
        r["page_id"]: WikiPage(
            id=r["page_id"], title=r["title"], content=r["content"],
            filePaths=[], importance="medium", relatedPages=[],
        )
        for r in pages_rows
    }
    wiki_structure = None
    if structure_row:
        try:
            wiki_structure = WikiStructureModel(**json.loads(structure_row["structure_json"]))
        except Exception:
            pass

    return WikiCacheData(
        wiki_structure=wiki_structure,
        generated_pages=generated_pages,
        repo=RepoInfo(
            owner=owner,
            repo=repo,
            type="local",
            localPath=source_path,
            repoUrl=source_path,
        ),
        source_path=source_path,
        artifact_root=artifact_root,
        provider=None,
        model=run.get("model") or None,
        language=language,
    )


# ── Git Roots ─────────────────────────────────────────────────────────────────

def _git_remote_to_web_url(remote: str) -> Optional[str]:
    if not remote:
        return None
    remote = re.sub(r"\.git$", "", remote.strip())
    m = re.match(r"^[\w.+-]+@([^:/]+):(.+)$", remote)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    m = re.match(r"^ssh://(?:[\w.+-]+@)?([^/:]+)(?::\d+)?/(.+)$", remote)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    if remote.startswith("http://") or remote.startswith("https://"):
        return remote
    return None


def _scan_git_roots(base_path: str, max_depth: int = 5) -> list[Dict]:
    import subprocess
    base_path = os.path.abspath(base_path)
    roots: list[Dict] = []
    skip = {"node_modules", ".trash", "dist", "build", "target", "out", ".next", "vendor"}

    def _git(args: list[str], cwd: str) -> str:
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
        tracked_files = sorted({
            line.replace(os.sep, "/")
            for line in _git(
                ["ls-files", "--cached", "--others", "--exclude-standard"],
                repo_dir,
            ).splitlines()
            if line.strip()
        })
        roots.append({"prefix": prefix, "name": os.path.basename(repo_dir),
                      "localPath": os.path.abspath(repo_dir),
                      "remote": remote or None, "webUrl": web_url,
                      "branch": branch or "main", "files": tracked_files})

    def _walk(current: str, depth: int) -> None:
        if os.path.exists(os.path.join(current, ".git")):
            _record(current)
            return
        if depth >= max_depth:
            return
        try:
            for entry in sorted(os.scandir(current), key=lambda e: e.name):
                if entry.is_dir(follow_symlinks=False) and not entry.name.startswith(".") and entry.name not in skip:
                    _walk(entry.path, depth + 1)
        except OSError:
            pass

    _walk(base_path, 0)
    return roots


@router.get("/api/git_roots")
async def get_git_roots(
    path: Optional[str] = Query(None),
    owner: Optional[str] = Query(None),
    repo: Optional[str] = Query(None),
    repo_type: str = Query("local"),
    language: str = Query("ko"),
    model: Optional[str] = Query(None),
):
    # Generation knows the source path before a wiki cache exists. Viewer calls
    # use the cache identity. Supporting both contracts keeps one .git-based
    # resolver as the source of truth.
    local_path = os.path.abspath(path) if path else None
    if not local_path and owner and repo:
        cache_data = await read_wiki_cache(owner, repo, repo_type, language, model)
        if cache_data is None and model:
            cache_data = await read_wiki_cache(owner, repo, repo_type, language)
        if cache_data and cache_data.repo:
            local_path = cache_data.repo.localPath or cache_data.repo.repoUrl

    if not local_path or not os.path.isdir(local_path):
        return {"localPath": local_path, "roots": []}

    roots = await asyncio.to_thread(_scan_git_roots, local_path)
    return {"localPath": local_path, "roots": roots}


class ResyncLinksRequest(BaseModel):
    owner: str
    repo: str
    repo_type: str = "local"
    language: str = "ko"
    model: Optional[str] = None


@router.post("/api/wiki/resync_links")
async def resync_wiki_links(req: ResyncLinksRequest):
    """Convert all file:/// links in cached wiki pages to proper GitHub URLs using gitRoots."""
    cache_data = await read_wiki_cache(req.owner, req.repo, req.repo_type, req.language, req.model)
    if cache_data is None and req.model:
        cache_data = await read_wiki_cache(req.owner, req.repo, req.repo_type, req.language)
    if not cache_data:
        raise HTTPException(status_code=404, detail="Wiki cache not found")

    local_path = None
    if cache_data.repo:
        local_path = cache_data.repo.localPath or cache_data.repo.repoUrl
    if not local_path or not os.path.isdir(local_path):
        raise HTTPException(status_code=400, detail=f"Project local path not found: {local_path}")

    roots = await asyncio.to_thread(_scan_git_roots, local_path)
    if not roots:
        return {"ok": True, "pages_updated": 0, "links_fixed": 0, "message": "No git roots found"}

    base_path = os.path.abspath(local_path)

    def _fix_links(content: str) -> tuple[str, int]:
        count = 0

        def _replace(m: re.Match) -> str:
            nonlocal count
            text, href = m.group(1), m.group(2)
            if not href.startswith("file://"):
                return m.group(0)

            local_file = href[len("file://"):]
            try:
                rel = os.path.relpath(local_file, base_path).replace(os.sep, "/")
            except ValueError:
                return m.group(0)
            if rel.startswith(".."):
                return m.group(0)

            matched = next(
                (r for r in sorted(roots, key=lambda x: len(x.get("prefix", "")), reverse=True)
                 if r.get("webUrl") and (
                     r["prefix"] == "" or rel == r["prefix"] or rel.startswith(r["prefix"] + "/")
                 )),
                None,
            )
            if not matched:
                return m.group(0)

            prefix = matched["prefix"]
            web_url = matched["webUrl"].rstrip("/")
            branch = matched.get("branch", "main")
            rel_in_repo = rel[len(prefix):].lstrip("/") if prefix else rel

            if not rel_in_repo:
                github_url = web_url
            elif "." in os.path.basename(rel_in_repo):
                github_url = f"{web_url}/blob/{branch}/{rel_in_repo}"
            else:
                github_url = f"{web_url}/tree/{branch}/{rel_in_repo}"

            count += 1
            return f"[{text}]({github_url})"

        new_content = re.sub(r"\[([^\]]+)\]\((file://[^)]+)\)", _replace, content)
        return new_content, count

    total_fixed = 0
    updated_pages: Dict[str, WikiPage] = {}
    for page_id, page in (cache_data.generated_pages or {}).items():
        new_content, fixed = _fix_links(page.content)
        total_fixed += fixed
        updated_pages[page_id] = WikiPage(
            id=page.id, title=page.title, content=new_content,
            filePaths=page.filePaths, importance=page.importance, relatedPages=page.relatedPages,
        )

    if total_fixed == 0:
        return {"ok": True, "pages_updated": 0, "links_fixed": 0, "message": "No file:// links found"}

    save_req = WikiCacheRequest(
        wiki_structure=cache_data.wiki_structure,
        generated_pages=updated_pages,
        repo=cache_data.repo,
        provider=cache_data.provider or "local",
        model=cache_data.model or req.model,
        language=cache_data.language or req.language,
    )
    await save_wiki_cache(save_req)

    return {"ok": True, "pages_updated": len(updated_pages), "links_fixed": total_fixed}


# ── Wiki RAG ──────────────────────────────────────────────────────────────────

from typing import Dict as DictType
from pydantic import BaseModel, Field


class WikiAskPageInput(BaseModel):
    id: str
    title: str
    content: str = ""


class WikiAskRequest(BaseModel):
    wiki_pages: List[WikiAskPageInput] = Field(...)
    question: str = Field(...)
    wiki_title: Optional[str] = Field("Wiki")
    history: Optional[List[DictType[str, str]]] = Field(None)
    provider: str = Field("google")
    model: Optional[str] = Field(None)
    language: Optional[str] = Field("ko")
    mode: Optional[str] = Field("cli")
    api_key: Optional[str] = Field(None)
    stream_id: Optional[str] = Field(None)
    top_k: Optional[int] = Field(None)


def _provider_to_cli(provider: str) -> str:
    return {"google": "gemini", "anthropic": "claude", "antigravity": "antigravity"}.get(provider, "codex")


@router.post("/wiki/ask/stream")
async def wiki_ask_stream(request: WikiAskRequest):
    from api.wiki_rag import retrieve_wiki_context
    from api.chat import chat_completions_stream, ChatCompletionRequest

    pages = [p.model_dump() for p in request.wiki_pages]
    try:
        context, _ = retrieve_wiki_context(pages, request.question, request.top_k)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"위키 임베딩/검색 실패: {e}")

    lang_line = (
        "Answer in English."
        if request.language == "en"
        else "Answer in Korean (한국어); keep technical terms and identifiers in English."
    )
    hist = ""
    if request.history:
        hist = "\n## Previous conversation\n" + "\n".join(
            f"{h.get('role', 'user')}: {h.get('content', '')}" for h in request.history
        ) + "\n"

    prompt = (
        f'You are a documentation assistant for the wiki titled "{request.wiki_title}".\n'
        f"Answer the question using ONLY the wiki excerpts below. If the answer is not present, "
        f"clearly say you could not find it. When you reference a page, cite as [[Exact Page Title]].\n"
        f"{lang_line}\n\n## Relevant wiki excerpts\n{context}\n{hist}\n## Question\n{request.question}"
    ) if context else (
        f"There is no indexable wiki content to answer from. "
        f"Tell the user you could not find relevant documentation. {lang_line}\n\n## Question\n{request.question}"
    )

    chat_req = ChatCompletionRequest(
        repo_url=request.wiki_title or "wiki",
        type="local",
        messages=[{"role": "user", "content": prompt}],
        model=request.model,
        provider=request.provider,
        language=request.language or "ko",
        skip_rag=True,
        is_wiki_generation=True,
        stream_id=request.stream_id,
        **({"use_cli": True, "cli_tool": _provider_to_cli(request.provider)} if (request.mode or "cli") == "cli" else {}),
        **({"api_key": request.api_key} if request.api_key else {}),
    )
    return await chat_completions_stream(chat_req)


@router.get("/wiki/rag/health")
async def wiki_rag_health():
    from api.wiki_rag import WIKI_EMBEDDER_TYPE
    if WIKI_EMBEDDER_TYPE == "none":
        return {"available": True, "model": "none", "embedder": "none"}
    model = configs.get("embedder_ollama", {}).get("model_kwargs", {}).get("model", "nomic-embed-text")
    available = False
    try:
        from api.ollama_patch import check_ollama_model_exists
        available = bool(check_ollama_model_exists(model))
    except Exception as e:
        logger.info(f"Wiki RAG health: Ollama unavailable ({e})")
    return {"available": available, "model": model, "embedder": "ollama"}
