"""Wiki cache I/O utilities — file-system backed JSON cache + wiki-out directory."""
import json
import logging
import os
import re
import shutil
import time
from datetime import datetime
from typing import Optional

from api.routes.models import (
    RepoInfo, WikiCacheData, WikiCacheRequest, WikiPage, WikiSection, WikiStructureModel,
)
from api.db.store import project_store, wiki_run_store
from api.runtime_env import product_env

logger = logging.getLogger(__name__)


def _extract_summary(content: str) -> str:
    """Return the first non-heading, non-empty line from markdown, max 160 chars."""
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('>') \
                and not line.startswith('|') and not line.startswith('```'):
            return line[:160]
    return ""


def _next_output_dir(wiki_out_root: str, base_name: str) -> str:
    """Return the next available numbered directory: base_01, base_02, …"""
    for i in range(1, 100):
        candidate = os.path.join(wiki_out_root, f"{base_name}_{i:02d}")
        if not os.path.exists(candidate):
            return candidate
    return os.path.join(wiki_out_root, f"{base_name}_99")


# ── Per-run directory registry ─────────────────────────────────────────────
# Prevents _02, _03 being created for incremental saves within the same run.
# Keyed by wiki_out_repo (e.g. "affiliate_agy-gemini-3.5-flash-high").
_active_dirs: dict[tuple[str, str], tuple[str, float]] = {}
_DIR_REUSE_WINDOW_SECS = 4 * 3600  # 4 hours; covers any realistic single run


WIKI_CACHE_DIR = product_env(
    "CACHE_DIR",
    os.path.join(os.path.expanduser("~/.adalflow"), "wikicache"),
) or os.path.join(os.path.expanduser("~/.adalflow"), "wikicache")
os.makedirs(WIKI_CACHE_DIR, exist_ok=True)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


def get_wiki_cache_path(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None
) -> str:
    model_str = (f"_{model}".replace("/", "-")) if model else ""
    filename = f"repolume_cache_{repo_type}_{owner}_{repo}_{language}{model_str}.json"
    return os.path.join(WIKI_CACHE_DIR, filename)


def get_legacy_wiki_cache_path(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None
) -> str:
    model_str = (f"_{model}".replace("/", "-")) if model else ""
    filename = f"localwiki_cache_{repo_type}_{owner}_{repo}_{language}{model_str}.json"
    return os.path.join(WIKI_CACHE_DIR, filename)


def _inject_meta_pages(cache_data: WikiCacheData, wiki_out_dir: str) -> WikiCacheData:
    """Inject index.md and log.md from disk as virtual pages into the cache data."""
    META_PAGES = [
        ("__wiki_index__", "📋 Wiki Index", "index.md"),
        ("__wiki_log__", "📜 Generation Log", "log.md"),
    ]
    injected: list[WikiPage] = []
    for page_id, title, filename in META_PAGES:
        fpath = os.path.join(wiki_out_dir, filename)
        if not os.path.exists(fpath):
            continue
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue
        injected.append(WikiPage(id=page_id, title=title, content=content, filePaths=[], importance="low", relatedPages=[]))

    if not injected:
        return cache_data

    # Deep-copy via dict to avoid mutating the original Pydantic object
    d = cache_data.model_dump()
    for page in injected:
        pd = page.model_dump()
        d["generated_pages"][page.id] = pd
        d["wiki_structure"]["pages"].append(pd)

    # Add / update __meta__ section in sections list
    meta_ids = [p.id for p in injected]
    sections = d["wiki_structure"].setdefault("sections", []) or []
    meta_sec = next((s for s in sections if s["id"] == "__meta__"), None)
    if meta_sec:
        meta_sec["pages"] = meta_ids
    else:
        sections.append({"id": "__meta__", "title": "📁 Meta", "pages": meta_ids, "subsections": None})
    d["wiki_structure"]["sections"] = sections

    root_secs = d["wiki_structure"].setdefault("rootSections", []) or []
    if "__meta__" not in root_secs:
        root_secs.append("__meta__")
    d["wiki_structure"]["rootSections"] = root_secs

    return WikiCacheData(**d)


async def read_wiki_cache(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None
) -> Optional[WikiCacheData]:
    cache_path = get_wiki_cache_path(owner, repo, repo_type, language, model)
    if not os.path.exists(cache_path):
        cache_path = get_legacy_wiki_cache_path(owner, repo, repo_type, language, model)
        if not os.path.exists(cache_path):
            return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = WikiCacheData(**json.load(f))
        # Inject index.md / log.md from the latest wiki-out directory
        wiki_out_repo = f"{repo}_{model}" if model else repo
        wiki_out_root = product_env("WIKI_OUT_DIR", os.path.join(_PROJECT_ROOT, "wiki-out")) or os.path.join(_PROJECT_ROOT, "wiki-out")
        wiki_out_dir = _latest_output_dir(wiki_out_root, wiki_out_repo)
        if wiki_out_dir:
            if not data.artifact_root:
                data.artifact_root = wiki_out_dir
            data = _inject_meta_pages(data, wiki_out_dir)
        if not data.source_path and data.repo:
            data.source_path = data.repo.localPath
        return data
    except Exception as e:
        logger.error(f"Error reading wiki cache from {cache_path}: {e}")
    return None



async def save_wiki_cache(data: WikiCacheRequest) -> bool:
    cache_path = get_wiki_cache_path(
        data.repo.owner, data.repo.repo, data.repo.type, data.language, data.model
    )
    logger.info(f"Saving wiki cache to: {cache_path}")
    try:
        source_path = data.repo.localPath
        existing_cache_path = cache_path
        if not os.path.exists(existing_cache_path):
            existing_cache_path = get_legacy_wiki_cache_path(
                data.repo.owner,
                data.repo.repo,
                data.repo.type,
                data.language,
                data.model,
            )
        if not source_path and os.path.exists(existing_cache_path):
            try:
                with open(existing_cache_path, "r", encoding="utf-8") as existing_file:
                    existing_cache = WikiCacheData(**json.load(existing_file))
                source_path = existing_cache.source_path or (
                    existing_cache.repo.localPath if existing_cache.repo else None
                )
            except (OSError, ValueError, json.JSONDecodeError):
                source_path = None
        repo_payload = data.repo.model_copy(
            update={
                "localPath": source_path,
                "repoUrl": data.repo.repoUrl or source_path,
            }
        )
        wiki_out_repo = f"{data.repo.repo}_{data.model}" if data.model else data.repo.repo
        wiki_out_root = product_env("WIKI_OUT_DIR", os.path.join(_PROJECT_ROOT, "wiki-out")) or os.path.join(_PROJECT_ROOT, "wiki-out")
        now = time.time()
        active_dir_key = (wiki_out_root, wiki_out_repo)
        cached_dir = _active_dirs.get(active_dir_key)
        if cached_dir and os.path.exists(cached_dir[0]) and now - cached_dir[1] < _DIR_REUSE_WINDOW_SECS:
            wiki_out_dir = cached_dir[0]
        else:
            wiki_out_dir = _next_output_dir(wiki_out_root, wiki_out_repo)
            _active_dirs[active_dir_key] = (wiki_out_dir, now)
        os.makedirs(wiki_out_dir, exist_ok=True)

        payload = WikiCacheData(
            wiki_structure=data.wiki_structure,
            generated_pages=data.generated_pages,
            repo=repo_payload,
            provider=data.provider,
            model=data.model,
            language=data.language,
            source_path=source_path,
            artifact_root=wiki_out_dir,
        )
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload.model_dump(), f, indent=2)
        logger.info(f"Wiki cache saved: {cache_path}")

        # Mirror generated pages as .md files in wiki-out/
        section_map: dict[str, str] = {}
        if data.wiki_structure and data.wiki_structure.sections:
            for sec in data.wiki_structure.sections:
                for pid in sec.pages:
                    section_map[pid] = sec.id

        for page_id, page in data.generated_pages.items():
            section_id = section_map.get(page_id)
            if section_id:
                sec_dir = os.path.join(wiki_out_dir, section_id)
                os.makedirs(sec_dir, exist_ok=True)
                page_path = os.path.join(sec_dir, f"{page_id}.md")
            else:
                page_path = os.path.join(wiki_out_dir, f"{page_id}.md")
            with open(page_path, "w", encoding="utf-8") as f:
                f.write(page.content)

        logger.info(f"Wiki markdown files saved to {wiki_out_dir}")

        # ── index.md: navigation catalog ──────────────────────────────────
        index_lines = ["# Wiki Index\n"]
        if data.wiki_structure and data.wiki_structure.sections:
            for sec in data.wiki_structure.sections:
                index_lines.append(f"\n## {sec.id}\n")
                index_lines.append("| Page | Path | Summary |")
                index_lines.append("|------|------|---------|")
                for pid in sec.pages:
                    page = data.generated_pages.get(pid)
                    if not page:
                        continue
                    rel_path = f"{sec.id}/{pid}.md"
                    summary = _extract_summary(page.content)
                    index_lines.append(f"| {page.title} | {rel_path} | {summary} |")
        else:
            index_lines.append("| Page | Path | Summary |")
            index_lines.append("|------|------|---------|")
            for pid, page in data.generated_pages.items():
                summary = _extract_summary(page.content)
                index_lines.append(f"| {page.title} | {pid}.md | {summary} |")
        with open(os.path.join(wiki_out_dir, "index.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(index_lines) + "\n")
        logger.info(f"index.md written to {wiki_out_dir}")

        # ── log.md: append-only audit trail ───────────────────────────────
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        page_count = len(data.generated_pages)
        agent_label = data.model or data.provider or "unknown"
        log_entry = f"## [{ts}] generate | {data.repo.repo} | {page_count} pages | agent: {agent_label}\n\n"
        with open(os.path.join(wiki_out_dir, "log.md"), "a", encoding="utf-8") as f:
            f.write(log_entry)
        logger.info(f"log.md updated in {wiki_out_dir}")

        # ── SQLite dual write ──────────────────────────────────────────────
        try:
            owner = data.repo.owner
            repo = data.repo.repo
            language = data.language or "ko"
            model = data.model or ""
            project_id = f"{owner}:{repo}:{language}"

            project_store.upsert(
                project_id,
                owner,
                repo,
                language,
                model or None,
                metadata={
                    "source_path": source_path,
                    "artifact_root": wiki_out_dir,
                },
            )
            run_id = wiki_run_store.upsert_run(project_id, model)

            if data.wiki_structure:
                wiki_run_store.upsert_structure(
                    run_id,
                    json.dumps(data.wiki_structure.model_dump()),
                )
            for page_id, page in data.generated_pages.items():
                wiki_run_store.upsert_page(run_id, page_id, page.title, page.content)

            logger.info(f"SQLite dual write complete: run_id={run_id} ({len(data.generated_pages)} pages)")
        except Exception as e:
            logger.warning(f"SQLite dual write failed (non-fatal): {e}", exc_info=True)

        return True
    except IOError as e:
        logger.error(f"IOError saving wiki cache: {e.strerror} (errno: {e.errno})", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"Unexpected error saving wiki cache: {e}", exc_info=True)
        return False


def _latest_output_dir(wiki_out_root: str, base_name: str) -> str | None:
    """Return the most recent numbered directory (highest _NN suffix), or None."""
    latest = None
    for i in range(99, 0, -1):
        candidate = os.path.join(wiki_out_root, f"{base_name}_{i:02d}")
        if os.path.exists(candidate):
            latest = candidate
            break
    # Fallback: legacy un-numbered directory
    if latest is None:
        plain = os.path.join(wiki_out_root, base_name)
        if os.path.exists(plain):
            latest = plain
    return latest


async def read_wiki_out_cache(
    repo: str, model: Optional[str] = None
) -> Optional[WikiCacheData]:
    wiki_out_repo = f"{repo}_{model}" if model else repo
    wiki_out_root = product_env("WIKI_OUT_DIR", os.path.join(_PROJECT_ROOT, "wiki-out")) or os.path.join(_PROJECT_ROOT, "wiki-out")
    wiki_out_dir = _latest_output_dir(wiki_out_root, wiki_out_repo)
    if not wiki_out_dir:
        return None

    pages: list[WikiPage] = []
    generated_pages: dict[str, WikiPage] = {}
    sections: list[WikiSection] = []
    root_sections: list[str] = []

    def _normalize(sid: str) -> str:
        # "gettingStarted", "getting_started", "getting-started" → "gettingstarted"
        return re.sub(r"[_\-\s]", "", sid).lower()

    def _section_sort_key(sid: str) -> tuple:
        s = _normalize(sid)
        if any(x in s for x in ("onboard", "gettingstarted", "overview", "intro", "quickstart")):
            return (0, sid)
        if any(x in s for x in ("deepdive", "advanced", "reference", "api")):
            return (2, sid)
        return (1, sid)

    # Collect dirs with modification times
    all_dirs = [
        (item, os.path.join(wiki_out_dir, item), os.path.getmtime(os.path.join(wiki_out_dir, item)))
        for item in os.listdir(wiki_out_dir)
        if os.path.isdir(os.path.join(wiki_out_dir, item)) and not item.startswith(".")
    ]

    # Group duplicate sections (e.g. "gettingStarted" + "getting_started") by normalized name.
    # Within each group, process newest dir first so newer pages win on ID conflict.
    groups: dict[str, list[tuple[str, str, float]]] = {}
    for item, item_path, mtime in all_dirs:
        key = _normalize(item)
        groups.setdefault(key, []).append((item, item_path, mtime))

    # Sort groups by section priority, then process each merged group
    sorted_keys = sorted(groups.keys(), key=lambda k: _section_sort_key(groups[k][0][0]))

    for norm_key in sorted_keys:
        group = sorted(groups[norm_key], key=lambda x: x[2], reverse=True)  # newest first
        # Use the newest directory's name as the canonical section ID
        canonical_id = group[0][0]
        root_sections.append(canonical_id)
        section_pages: list[str] = []
        seen_page_ids: set[str] = set()
        for _, item_path, _ in group:
            for fname in sorted(os.listdir(item_path)):
                if fname.endswith(".md"):
                    page_id = fname[:-3]
                    if page_id in seen_page_ids:
                        continue
                    seen_page_ids.add(page_id)
                    section_pages.append(page_id)
                    with open(os.path.join(item_path, fname), "r", encoding="utf-8") as f:
                        content = f.read()
                    page_obj = WikiPage(
                        id=page_id, title=page_id, content=content,
                        filePaths=[], importance="medium", relatedPages=[],
                    )
                    pages.append(page_obj)
                    generated_pages[page_id] = page_obj
        sections.append(WikiSection(id=canonical_id, title=canonical_id, pages=section_pages))

    # Inject index.md / log.md as meta pages
    meta_page_ids: list[str] = []
    for page_id, title, filename in [("__wiki_index__", "📋 Wiki Index", "index.md"), ("__wiki_log__", "📜 Generation Log", "log.md")]:
        fpath = os.path.join(wiki_out_dir, filename)
        if os.path.exists(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                page_obj = WikiPage(id=page_id, title=title, content=content, filePaths=[], importance="low", relatedPages=[])
                pages.append(page_obj)
                generated_pages[page_id] = page_obj
                meta_page_ids.append(page_id)
            except Exception:
                pass
    if meta_page_ids:
        sections.append(WikiSection(id="__meta__", title="📁 Meta", pages=meta_page_ids))
        root_sections.append("__meta__")

    return WikiCacheData(
        wiki_structure=WikiStructureModel(
            id=repo, title=f"{repo} Wiki",
            description="Generated from wiki-out folder",
            pages=pages, sections=sections, rootSections=root_sections,
        ),
        generated_pages=generated_pages,
        repo=RepoInfo(
            owner="local", repo=repo, type="local",
            localPath=wiki_out_dir, repoUrl=wiki_out_dir,
        ),
        source_path=None,
        artifact_root=wiki_out_dir,
        provider="local",
        model="local",
    )


def cleanup_trash() -> None:
    """Remove .trash entries older than 3 days."""
    ttl = 3 * 24 * 3600
    now = time.time()
    trash_dirs = [
        os.path.join(WIKI_CACHE_DIR, ".trash"),
        os.path.join(_PROJECT_ROOT, "wiki-out", ".trash"),
    ]
    for trash_dir in trash_dirs:
        if not os.path.exists(trash_dir):
            continue
        for name in os.listdir(trash_dir):
            path = os.path.join(trash_dir, name)
            if now - os.path.getmtime(path) > ttl:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                logger.info(f"Deleted expired trash: {path}")
