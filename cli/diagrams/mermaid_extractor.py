"""
Mermaid diagram extractor.

Scans Markdown files and extracts all Mermaid fenced code blocks alongside
their surrounding context.
"""
from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Matches ```mermaid ... ``` blocks (non-greedy, DOTALL)
_MERMAID_RE = re.compile(
    r"```mermaid\s*\n(.*?)```",
    re.DOTALL | re.IGNORECASE,
)

# Matches the first H2/H3 heading before or after a block (for context)
_HEADING_RE = re.compile(r"^#{1,3}\s+(.+)$", re.MULTILINE)


@dataclass
class MermaidDiagram:
    """A single extracted Mermaid diagram with metadata."""

    source_file: str          # relative path of the .md file
    diagram_type: str         # "flowchart", "sequenceDiagram", "classDiagram", etc.
    content: str              # raw Mermaid DSL (without the fences)
    heading_context: str = "" # nearest heading before this block
    char_offset: int = 0      # position in original file


@dataclass
class DiagramCollection:
    """All diagrams extracted from a directory."""

    diagrams: List[MermaidDiagram] = field(default_factory=list)

    def by_type(self, diagram_type: str) -> List[MermaidDiagram]:
        """Filter by diagram type prefix (e.g. 'graph', 'sequenceDiagram')."""
        t = diagram_type.lower()
        return [d for d in self.diagrams if d.diagram_type.lower().startswith(t)]

    def as_dict(self) -> Dict[str, List[MermaidDiagram]]:
        """Group by source file."""
        result: Dict[str, List[MermaidDiagram]] = {}
        for d in self.diagrams:
            result.setdefault(d.source_file, []).append(d)
        return result

    def best_architecture_diagram(self) -> Optional[MermaidDiagram]:
        """Return the most likely top-level architecture diagram."""
        # Prefer graph LR/TD diagrams (component overview style)
        candidates = [
            d for d in self.diagrams
            if d.diagram_type.lower().startswith("graph")
        ]
        if not candidates:
            candidates = self.diagrams
        # Longest diagram = most detailed = best overview
        return max(candidates, key=lambda d: len(d.content)) if candidates else None

    def for_topic(self, topic: str) -> Optional[MermaidDiagram]:
        """Find the diagram whose source file or heading best matches a topic."""
        topic_lower = topic.lower()
        scored = []
        for d in self.diagrams:
            score = 0
            if topic_lower in d.source_file.lower():
                score += 3
            if topic_lower in d.heading_context.lower():
                score += 2
            if topic_lower in d.content.lower():
                score += 1
            scored.append((score, d))
        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best = scored[0] if scored else (0, None)
        return best if best_score > 0 else None


def extract_from_file(md_path: Path, base_dir: Optional[Path] = None) -> List[MermaidDiagram]:
    """Extract all Mermaid diagrams from a single Markdown file."""
    try:
        text = md_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        logger.warning(f"Cannot read {md_path}: {e}")
        return []

    rel_path = str(md_path.relative_to(base_dir)) if base_dir else md_path.name

    # Build heading index: {char_offset: heading_text}
    heading_index = {m.start(): m.group(1) for m in _HEADING_RE.finditer(text)}
    heading_offsets = sorted(heading_index.keys())

    diagrams: List[MermaidDiagram] = []
    for match in _MERMAID_RE.finditer(text):
        raw = match.group(1).strip()
        if not raw:
            continue

        # Detect diagram type from first line
        first_line = raw.split("\n")[0].strip()
        if first_line.startswith("graph"):
            dtype = "graph"
        elif first_line.lower().startswith("sequencediagram"):
            dtype = "sequenceDiagram"
        elif first_line.lower().startswith("classdiagram"):
            dtype = "classDiagram"
        elif first_line.lower().startswith("erdiagram"):
            dtype = "erDiagram"
        elif first_line.lower().startswith("statediagram"):
            dtype = "stateDiagram"
        elif first_line.lower().startswith("flowchart"):
            dtype = "flowchart"
        else:
            dtype = first_line.split()[0] if first_line else "unknown"

        # Find nearest preceding heading
        offset = match.start()
        preceding = [h for h in heading_offsets if h < offset]
        heading = heading_index[preceding[-1]] if preceding else ""

        diagrams.append(
            MermaidDiagram(
                source_file=rel_path,
                diagram_type=dtype,
                content=raw,
                heading_context=heading,
                char_offset=offset,
            )
        )

    return diagrams


def extract_from_directory(directory: Path) -> DiagramCollection:
    """
    Recursively scan a directory for .md files and extract all Mermaid diagrams.

    Typical use: extract_from_directory(repo_path / "docs")
    """
    if not directory.is_dir():
        logger.warning(f"Not a directory (no diagrams): {directory}")
        return DiagramCollection()

    collection = DiagramCollection()
    md_files = list(directory.rglob("*.md"))
    logger.info(f"Scanning {len(md_files)} Markdown files in {directory}")

    for md_file in sorted(md_files):
        diagrams = extract_from_file(md_file, base_dir=directory)
        collection.diagrams.extend(diagrams)
        if diagrams:
            logger.debug(f"  {md_file.name}: {len(diagrams)} diagram(s)")

    logger.info(
        f"Extracted {len(collection.diagrams)} Mermaid diagrams from {directory.name}/"
    )
    return collection
