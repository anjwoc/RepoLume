"""
BaseExporter — Abstract base class for all wiki exporters.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict


@dataclass
class ExportResult:
    """Result of an export operation."""
    success: bool
    exported_count: int
    target: str                 # e.g. "notion", "obsidian"
    errors: List[str] = field(default_factory=list)
    urls: List[str] = field(default_factory=list)     # Created page URLs (if applicable)
    output_path: Optional[str] = None                 # Local path (for file-based exports)

    @property
    def failed(self) -> bool:
        return not self.success or bool(self.errors)


class BaseExporter(ABC):
    """Abstract exporter interface."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Export target name (e.g. 'notion', 'obsidian')."""
        ...

    @abstractmethod
    def export(
        self,
        pages: Dict[str, str],  # page_id -> markdown content
        wiki_title: str,
        **kwargs,
    ) -> ExportResult:
        """Export wiki pages to the target platform."""
        ...

    def _clean_markdown(self, md: str) -> str:
        """Strip LocalWiki-specific markers from markdown."""
        import re
        # Remove <details> source file blocks
        md = re.sub(r"<details>.*?</details>", "", md, flags=re.DOTALL)
        # Remove internal link syntax artifacts
        md = md.strip()
        return md
