"""Wiki export endpoints: markdown (single/tree), JSON, Notion, Obsidian."""
import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from api.routes.models import WikiExportRequest, WikiPage, WikiStructureModel

logger = logging.getLogger(__name__)
router = APIRouter()


def generate_markdown_export(repo_url: str, pages: List[WikiPage]) -> str:
    md = f"# Wiki Documentation for {repo_url}\n\n"
    md += f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    md += "## Table of Contents\n\n"
    for page in pages:
        md += f"- [{page.title}](#{page.id})\n"
    md += "\n"
    for page in pages:
        md += f"<a id='{page.id}'></a>\n\n## {page.title}\n\n"
        if page.relatedPages:
            related_titles = []
            for rid in page.relatedPages:
                rp = next((p for p in pages if p.id == rid), None)
                if rp:
                    related_titles.append(f"[{rp.title}](#{rid})")
            if related_titles:
                md += "### Related Pages\n\nRelated topics: " + ", ".join(related_titles) + "\n\n"
        md += f"{page.content}\n\n---\n\n"
    return md


def generate_markdown_tree_zip(
    repo_url: str, pages: List[WikiPage], wiki_structure: Optional[WikiStructureModel]
) -> bytes:
    import io
    import re
    import zipfile

    def slug(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")

    page_by_id = {p.id: p for p in pages}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    index_lines = [f"# Wiki Documentation for {repo_url}\n", f"\nGenerated on: {timestamp}\n"]
    used_ids: set[str] = set()

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
    return json.dumps({
        "metadata": {
            "repository": repo_url,
            "generated_at": datetime.now().isoformat(),
            "page_count": len(pages),
        },
        "pages": [p.model_dump() for p in pages],
    }, indent=2)


@router.post("/export/wiki")
async def export_wiki(request: WikiExportRequest):
    try:
        repo_name = request.repo_url.rstrip("/").split("/")[-1] or "wiki"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        if request.format == "markdown" and request.structure == "tree":
            content = generate_markdown_tree_zip(request.repo_url, request.pages, request.wiki_structure)
            return Response(
                content=content, media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={repo_name}_wiki_{timestamp}.zip"},
            )
        elif request.format == "markdown":
            content = generate_markdown_export(request.repo_url, request.pages)
            return Response(
                content=content, media_type="text/markdown",
                headers={"Content-Disposition": f"attachment; filename={repo_name}_wiki_{timestamp}.md"},
            )
        else:
            content = generate_json_export(request.repo_url, request.pages)
            return Response(
                content=content, media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={repo_name}_wiki_{timestamp}.json"},
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error exporting wiki: {e}")


@router.post("/export/notion")
async def export_notion(
    request: WikiExportRequest,
    api_key: str = Query(...),
    parent_page_id: str = Query(...),
):
    try:
        from cli.exporters.notion_exporter import NotionExporter
        exporter = NotionExporter(api_key=api_key, parent_page_id=parent_page_id)
        repo_name = request.repo_url.rstrip("/").split("/")[-1] or "wiki"
        result = exporter.export(request.pages, wiki_title=f"{repo_name} Wiki")
        if result.failed:
            raise HTTPException(status_code=500, detail="\n".join(result.errors))
        return {"success": True, "exported_count": result.exported_count, "urls": result.urls}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export/obsidian")
async def export_obsidian(request: WikiExportRequest, vault_path: str = Query(...)):
    try:
        from cli.exporters.obsidian_exporter import ObsidianExporter
        exporter = ObsidianExporter(vault_path=vault_path)
        repo_name = request.repo_url.rstrip("/").split("/")[-1] or "wiki"
        result = exporter.export(request.pages, wiki_title=f"{repo_name} Wiki")
        if result.failed:
            raise HTTPException(status_code=500, detail="\n".join(result.errors))
        return {"success": True, "exported_count": result.exported_count, "output_path": result.output_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
