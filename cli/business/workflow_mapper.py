"""
WorkflowMapper — Maps business workflows and user journeys through the codebase.

Identifies:
  - User-facing workflows (e.g., checkout, authentication, onboarding)
  - System workflows (e.g., data ingestion, batch processing, event handling)
  - Integration workflows (e.g., third-party API calls, webhooks)
  - Error/exception workflows
"""
from __future__ import annotations

import logging
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional

from cli.prompts import WORKFLOW_PROMPT

logger = logging.getLogger(__name__)


@dataclass
class WorkflowStep:
    """A single step in a business workflow."""
    id: str
    label: str
    actor: str          # "user" | "system" | "external"
    source_file: str = ""
    description: str = ""


@dataclass
class BusinessWorkflow:
    """A named business workflow with steps."""
    name: str
    description: str
    workflow_type: str          # "user" | "system" | "integration" | "error"
    steps: List[WorkflowStep] = field(default_factory=list)
    mermaid_diagram: str = ""
    business_importance: str = "medium"   # "high" | "medium" | "low"


class WorkflowMapper:
    """
    Uses LLM to identify and map business workflows.

    Usage::

        mapper = WorkflowMapper(provider, repo)
        workflows = mapper.map(file_tree, readme, entities, lang="ko")
        md = mapper.render_markdown(workflows, lang="ko")
    """

    def __init__(self, provider, repo):
        self._provider = provider
        self._repo = repo

    def map(
        self,
        file_tree: str,
        readme: str,
        entities=None,
        lang: str = "en",
    ) -> List[BusinessWorkflow]:
        """Run LLM-based workflow mapping."""
        from cli.pipeline.structure_planner import LANGUAGE_NAMES
        language_name = LANGUAGE_NAMES.get(lang, "English")

        entity_names = ""
        if entities:
            entity_names = ", ".join(e.name for e in entities[:10])

        prompt = WORKFLOW_PROMPT.format(
            file_tree=file_tree,
            readme=readme,
            entity_names=entity_names or "(see file tree)",
            language_name=language_name,
        )

        try:
            raw = self._provider.generate(prompt)
            return self._parse(raw)
        except Exception as e:
            logger.warning(f"Workflow mapping failed: {e}")
            return []

    def _parse(self, raw: str) -> List[BusinessWorkflow]:
        """Parse LLM JSON response into list of BusinessWorkflow."""
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)

        try:
            match = re.search(r"\[.*\]", clean, re.DOTALL)
            if not match:
                return []
            data = json.loads(match.group())
        except json.JSONDecodeError as e:
            logger.warning(f"Workflow JSON parse error: {e}")
            return []

        workflows = []
        for item in data:
            steps = [
                WorkflowStep(
                    id=s.get("id", f"step_{i}"),
                    label=s.get("label", ""),
                    actor=s.get("actor", "system"),
                    source_file=s.get("source_file", ""),
                    description=s.get("description", ""),
                )
                for i, s in enumerate(item.get("steps", []))
            ]
            mermaid = self._build_mermaid(item.get("name", "Workflow"), steps)
            workflows.append(BusinessWorkflow(
                name=item.get("name", "Workflow"),
                description=item.get("description", ""),
                workflow_type=item.get("type", "system"),
                steps=steps,
                mermaid_diagram=mermaid,
                business_importance=item.get("business_importance", "medium"),
            ))

        # Sort by importance
        order = {"high": 0, "medium": 1, "low": 2}
        workflows.sort(key=lambda w: order.get(w.business_importance, 1))
        return workflows

    def _build_mermaid(self, name: str, steps: List[WorkflowStep]) -> str:
        """Generate a sequence diagram from workflow steps."""
        if not steps:
            return ""

        actors = list(dict.fromkeys(s.actor for s in steps))
        lines = ["sequenceDiagram"]
        for actor in actors:
            label = actor.capitalize()
            lines.append(f"    participant {actor} as {label}")

        for i, step in enumerate(steps):
            if i + 1 < len(steps):
                next_actor = steps[i + 1].actor
                label = step.label.replace('"', "'")
                lines.append(f"    {step.actor}->>{next_actor}: {label}")

        return "\n".join(lines)

    def render_markdown(
        self, workflows: List[BusinessWorkflow], lang: str = "en"
    ) -> str:
        """Render workflows to markdown with Mermaid sequence diagrams."""
        if not workflows:
            return ""

        lines = [
            "## Business Workflows",
            "",
            "The following workflows describe how key business processes are "
            "implemented across the codebase.",
            "",
        ]

        type_emoji = {
            "user": "👤",
            "system": "⚙️",
            "integration": "🔗",
            "error": "⚠️",
        }

        importance_badge = {
            "high": "🔴 **HIGH**",
            "medium": "🟡 **MEDIUM**",
            "low": "🟢 **LOW**",
        }

        for wf in workflows:
            emoji = type_emoji.get(wf.workflow_type, "📋")
            badge = importance_badge.get(wf.business_importance, "")
            lines += [
                f"### {emoji} {wf.name}",
                "",
                f"> Business Importance: {badge}  |  Type: `{wf.workflow_type}`",
                "",
                wf.description,
                "",
            ]

            if wf.mermaid_diagram:
                lines += [
                    "```mermaid",
                    wf.mermaid_diagram,
                    "```",
                    "",
                ]

            if wf.steps:
                lines += [
                    "**Workflow Steps:**",
                    "",
                ]
                for i, step in enumerate(wf.steps, 1):
                    actor_label = {
                        "user": "👤 User",
                        "system": "⚙️ System",
                        "external": "🌐 External",
                    }.get(step.actor, step.actor)
                    src = f" — `{step.source_file}`" if step.source_file else ""
                    lines.append(f"{i}. **{step.label}** ({actor_label}){src}")
                    if step.description:
                        lines.append(f"   _{step.description}_")
                lines.append("")

        return "\n".join(lines)
