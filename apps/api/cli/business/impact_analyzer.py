"""
ImpactAnalyzer — Analyzes the business impact of key code components.

For each critical component/module, identifies:
  - What business capability it enables
  - What breaks if it fails (downstream impact)
  - Revenue/user impact level
  - Suggested monitoring / alerting priority
"""
from __future__ import annotations

import logging
import json
import re
from dataclasses import dataclass, field
from typing import List

from cli.prompts import IMPACT_ANALYSIS_PROMPT

logger = logging.getLogger(__name__)


@dataclass
class ComponentImpact:
    """Business impact analysis for a single code component."""
    component_name: str
    source_files: List[str]
    business_capability: str        # What business function this enables
    failure_impact: str             # What breaks if this component fails
    impact_level: str               # "critical" | "high" | "medium" | "low"
    downstream_components: List[str] = field(default_factory=list)
    monitoring_priority: str = "medium"
    recommended_slo: str = ""


class ImpactAnalyzer:
    """
    Uses LLM to identify and rank the business impact of key components.

    Usage::

        analyzer = ImpactAnalyzer(provider, repo)
        impacts = analyzer.analyze(file_tree, entities, workflows, lang="ko")
        md = analyzer.render_markdown(impacts, lang="ko")
    """

    def __init__(self, provider, repo):
        self._provider = provider
        self._repo = repo

    def analyze(
        self,
        file_tree: str,
        entities=None,
        workflows=None,
        lang: str = "en",
    ) -> List[ComponentImpact]:
        """Run LLM-based business impact analysis."""
        from cli.pipeline.structure_planner import LANGUAGE_NAMES
        language_name = LANGUAGE_NAMES.get(lang, "English")

        entity_names = ""
        if entities:
            entity_names = ", ".join(e.name for e in entities[:10])

        workflow_names = ""
        if workflows:
            workflow_names = ", ".join(w.name for w in workflows[:8])

        prompt = IMPACT_ANALYSIS_PROMPT.format(
            file_tree=file_tree,
            entity_names=entity_names or "(see file tree)",
            workflow_names=workflow_names or "(see file tree)",
            language_name=language_name,
        )

        try:
            raw = self._provider.generate(prompt)
            return self._parse(raw)
        except Exception as e:
            logger.warning(f"Impact analysis failed: {e}")
            return []

    def _parse(self, raw: str) -> List[ComponentImpact]:
        """Parse LLM JSON response into list of ComponentImpact."""
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)

        try:
            match = re.search(r"\[.*\]", clean, re.DOTALL)
            if not match:
                return []
            data = json.loads(match.group())
        except json.JSONDecodeError as e:
            logger.warning(f"Impact JSON parse error: {e}")
            return []

        impacts = [
            ComponentImpact(
                component_name=item.get("component", ""),
                source_files=item.get("source_files", []),
                business_capability=item.get("business_capability", ""),
                failure_impact=item.get("failure_impact", ""),
                impact_level=item.get("impact_level", "medium"),
                downstream_components=item.get("downstream_components", []),
                monitoring_priority=item.get("monitoring_priority", "medium"),
                recommended_slo=item.get("recommended_slo", ""),
            )
            for item in data if item.get("component")
        ]

        # Sort by impact level
        order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        impacts.sort(key=lambda x: order.get(x.impact_level, 2))
        return impacts

    def render_markdown(
        self, impacts: List[ComponentImpact], lang: str = "en"
    ) -> str:
        """Render impact analysis to markdown."""
        if not impacts:
            return ""

        lines = [
            "## Business Impact Analysis",
            "",
            "This section identifies the business impact of critical code components "
            "— helping prioritize monitoring, testing, and reliability investments.",
            "",
        ]

        level_emoji = {
            "critical": "🔴",
            "high": "🟠",
            "medium": "🟡",
            "low": "🟢",
        }

        # Impact matrix table
        lines += [
            "### Impact Matrix",
            "",
            "| Component | Impact Level | Business Capability | Monitoring Priority |",
            "|-----------|-------------|---------------------|---------------------|",
        ]
        for impact in impacts:
            emoji = level_emoji.get(impact.impact_level, "⚪")
            lines.append(
                f"| **{impact.component_name}** | "
                f"{emoji} {impact.impact_level.upper()} | "
                f"{impact.business_capability[:60]}... | "
                f"{impact.monitoring_priority} |"
            )
        lines.append("")

        # Detailed breakdown
        lines += ["### Detailed Breakdown", ""]

        for impact in impacts:
            emoji = level_emoji.get(impact.impact_level, "⚪")
            lines += [
                f"#### {emoji} {impact.component_name}",
                "",
                f"**Impact Level:** `{impact.impact_level.upper()}`  |  "
                f"**Monitoring Priority:** `{impact.monitoring_priority}`",
                "",
                f"**Business Capability:**  \n{impact.business_capability}",
                "",
                f"**Failure Impact:**  \n{impact.failure_impact}",
                "",
            ]
            if impact.source_files:
                files = ", ".join(f"`{f}`" for f in impact.source_files[:5])
                lines += [f"**Source Files:** {files}", ""]
            if impact.downstream_components:
                downs = ", ".join(impact.downstream_components)
                lines += [f"**Downstream Dependencies:** {downs}", ""]
            if impact.recommended_slo:
                lines += [f"**Recommended SLO:** {impact.recommended_slo}", ""]

        return "\n".join(lines)
