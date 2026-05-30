"""
File Exporter — writes generated wiki pages to disk as Markdown files,
mirroring the section hierarchy into a directory tree.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Dict

from cli.pipeline.structure_planner import WikiStructure

logger = logging.getLogger(__name__)


def _slugify(text: str) -> str:
    """Convert a title to a filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


class FileExporter:
    """
    Exports a WikiStructure + generated page contents to disk.

    Output layout::

        <output_dir>/
        ├── README.md              ← wiki index
        ├── <section-slug>/
        │   ├── <page-slug>.md
        │   └── ...
        └── ...
    """

    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)

    def export(
        self,
        structure: WikiStructure,
        page_contents: Dict[str, str],  # {page_id: markdown}
    ) -> Path:
        """
        Write all files and return the output directory path.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Build section slug map
        section_slug: Dict[str, str] = {}
        for section in structure.sections:
            section_slug[section.id] = _slugify(section.title)

        # Write each page
        for page in structure.pages:
            content = page_contents.get(page.id, "")
            if not content:
                logger.warning(f"No content for page '{page.title}', skipping export")
                continue

            # Determine directory
            if page.section_id and page.section_id in section_slug:
                subdir = self.output_dir / section_slug[page.section_id]
            else:
                subdir = self.output_dir

            subdir.mkdir(parents=True, exist_ok=True)
            filename = _slugify(page.title) + ".md"
            dest = subdir / filename
            dest.write_text(content, encoding="utf-8")
            logger.debug(f"Wrote: {dest.relative_to(self.output_dir)}")

        # Write index README
        self._write_index(structure, section_slug, page_contents)

        logger.info(f"Wiki exported to: {self.output_dir}")
        return self.output_dir

    # ------------------------------------------------------------------ #

    def _write_index(
        self,
        structure: WikiStructure,
        section_slug: Dict[str, str],
        page_contents: Dict[str, str],
    ) -> None:
        lines = [
            f"# {structure.title}",
            "",
            structure.description,
            "",
            "## Table of Contents",
            "",
        ]

        for section_id in structure.root_section_ids:
            section = next((s for s in structure.sections if s.id == section_id), None)
            if section is None:
                continue

            slug = section_slug.get(section_id, _slugify(section.title))
            lines.append(f"### {section.title}")
            lines.append("")

            for page_id in section.page_ids:
                page = structure.page_by_id(page_id)
                if page is None:
                    continue
                page_slug = _slugify(page.title)
                rel_path = f"{slug}/{page_slug}.md"
                importance_badge = {
                    "high": "⭐",
                    "medium": "📄",
                    "low": "📎",
                }.get(page.importance, "📄")
                lines.append(f"- {importance_badge} [{page.title}]({rel_path})")
                if page.description:
                    lines.append(f"  > {page.description}")

            lines.append("")

        index_path = self.output_dir / "README.md"
        index_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"Index written: {index_path}")
