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

logger = logging.getLogger(__name__)


def _extract_summary(content: str) -> str:
    """Return the first non-heading, non-empty line from markdown, max 160 chars."""
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('>') \
                and not line.startswith('|') and not line.startswith('```'):
            return line[:160]
    return ""


WIKI_CACHE_DIR = os.path.join(os.path.expanduser("~/.adalflow"), "wikicache")
os.makedirs(WIKI_CACHE_DIR, exist_ok=True)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_wiki_cache_path(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None
) -> str:
    model_str = (f"_{model}".replace("/", "-")) if model else ""
    filename = f"localwiki_cache_{repo_type}_{owner}_{repo}_{language}{model_str}.json"
    return os.path.join(WIKI_CACHE_DIR, filename)


async def read_wiki_cache(
    owner: str, repo: str, repo_type: str, language: str, model: Optional[str] = None
) -> Optional[WikiCacheData]:
    cache_path = get_wiki_cache_path(owner, repo, repo_type, language, model)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return WikiCacheData(**json.load(f))
        except Exception as e:
            logger.error(f"Error reading wiki cache from {cache_path}: {e}")
    return None



async def save_wiki_cache(data: WikiCacheRequest) -> bool:
    cache_path = get_wiki_cache_path(
        data.repo.owner, data.repo.repo, data.repo.type, data.language, data.model
    )
    logger.info(f"Saving wiki cache to: {cache_path}")
    try:
        payload = WikiCacheData(
            wiki_structure=data.wiki_structure,
            generated_pages=data.generated_pages,
            repo=data.repo,
            provider=data.provider,
            model=data.model,
            language=data.language,
        )
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload.model_dump(), f, indent=2)
        logger.info(f"Wiki cache saved: {cache_path}")

        # Mirror generated pages as .md files in wiki-out/
        wiki_out_repo = f"{data.repo.repo}_{data.model}" if data.model else data.repo.repo
        wiki_out_dir = os.path.join(_PROJECT_ROOT, "wiki-out", wiki_out_repo)
        os.makedirs(wiki_out_dir, exist_ok=True)

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

        return True
    except IOError as e:
        logger.error(f"IOError saving wiki cache: {e.strerror} (errno: {e.errno})", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"Unexpected error saving wiki cache: {e}", exc_info=True)
        return False


async def read_wiki_out_cache(
    repo: str, model: Optional[str] = None
) -> Optional[WikiCacheData]:
    wiki_out_repo = f"{repo}_{model}" if model else repo
    wiki_out_dir = os.path.join(_PROJECT_ROOT, "wiki-out", wiki_out_repo)
    if not os.path.exists(wiki_out_dir):
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
