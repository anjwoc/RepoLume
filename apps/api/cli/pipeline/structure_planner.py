"""
Wiki Structure Planner — calls LLM with file tree + README
and parses the JSON response into a WikiStructure dataclass.
"""
from __future__ import annotations

import json
import re
import logging
from dataclasses import dataclass, field
from typing import List

from cli.prompts import WIKI_STRUCTURE_PROMPT

logger = logging.getLogger(__name__)

LANGUAGE_NAMES = {
    "en": "English",
    "ko": "Korean (한국어)",
    "ja": "Japanese (日本語)",
    "zh": "Mandarin Chinese (中文)",
    "zh-tw": "Traditional Chinese (繁體中文)",
    "es": "Spanish (Español)",
    "vi": "Vietnamese (Tiếng Việt)",
    "pt-br": "Brazilian Portuguese (Português Brasileiro)",
    "fr": "Français (French)",
    "ru": "Русский (Russian)",
}


@dataclass
class WikiSection:
    id: str
    title: str
    page_ids: List[str] = field(default_factory=list)


@dataclass
class WikiPage:
    id: str
    title: str
    description: str
    importance: str          # "high" | "medium" | "low"
    file_paths: List[str]    # relative paths inside the repo
    related_page_ids: List[str] = field(default_factory=list)
    section_id: str = ""


@dataclass
class WikiStructure:
    id: str
    title: str
    description: str
    sections: List[WikiSection]
    pages: List[WikiPage]
    root_section_ids: List[str]

    def page_by_id(self, page_id: str) -> WikiPage | None:
        for p in self.pages:
            if p.id == page_id:
                return p
        return None


class WikiStructurePlanner:
    """
    Plans wiki structure using the LLM.

    Usage::

        planner = WikiStructurePlanner(provider)
        structure = planner.plan(repo, repo_name="my-repo", lang="ko")
    """

    def __init__(self, provider):
        self._provider = provider

    def plan(self, repo, repo_name: str, lang: str = "en") -> WikiStructure:
        """
        Args:
            repo: LocalRepo instance (has .file_tree() and .readme())
            repo_name: human-readable repository name
            lang: language code for generated content
        """
        language_name = LANGUAGE_NAMES.get(lang, "English")

        file_tree = repo.file_tree()
        readme = repo.readme() or "(no README found)"
        # Truncate huge READMEs to avoid token overflow
        if len(readme) > 8_000:
            readme = readme[:8_000] + "\n...(truncated)"

        prompt = WIKI_STRUCTURE_PROMPT.format(
            repo_name=repo_name,
            file_tree=file_tree,
            readme=readme,
            language_name=language_name,
        )

        logger.info("Requesting wiki structure from LLM…")
        raw = self._provider.generate(prompt)
        return self._parse(raw)

    # ------------------------------------------------------------------ #

    def _parse(self, raw: str) -> WikiStructure:
        """Extract JSON from LLM response and parse into WikiStructure."""
        # Strip markdown fences if the model wrapped the JSON
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)

        try:
            data = json.loads(clean)
        except json.JSONDecodeError:
            # Try extracting the first {...} block
            match = re.search(r"\{.*\}", clean, re.DOTALL)
            if not match:
                raise ValueError(
                    "LLM did not return valid JSON for wiki structure.\n"
                    f"Raw response (first 500 chars):\n{raw[:500]}"
                )
            data = json.loads(match.group())

        sections = [
            WikiSection(
                id=s["id"],
                title=s["title"],
                page_ids=s.get("pageIds", []),
            )
            for s in data.get("sections", [])
        ]

        pages = [
            WikiPage(
                id=p["id"],
                title=p["title"],
                description=p.get("description", ""),
                importance=p.get("importance", "medium"),
                file_paths=p.get("filePaths", []),
                related_page_ids=p.get("relatedPageIds", []),
                section_id=p.get("sectionId", ""),
            )
            for p in data.get("pages", [])
        ]

        return WikiStructure(
            id=data.get("id", "wiki-root"),
            title=data.get("title", "Wiki"),
            description=data.get("description", ""),
            sections=sections,
            pages=pages,
            root_section_ids=data.get("rootSectionIds", [s.id for s in sections]),
        )
