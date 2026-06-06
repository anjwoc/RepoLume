"""
DataFlowTracer — Traces how data flows through the business system.

Identifies:
  - Data entry points (APIs, forms, file imports, events)
  - Data transformations (processing, validation, enrichment)
  - Data storage patterns (DB writes, caches, queues)
  - Data exit points (API responses, exports, notifications)
  - Cross-boundary data flows (service-to-service, external APIs)
"""
from __future__ import annotations

import logging
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional

from cli.prompts import DATA_FLOW_PROMPT

logger = logging.getLogger(__name__)


@dataclass
class DataFlowNode:
    """A single node in the data flow graph."""
    id: str
    label: str
    node_type: str          # "entry" | "process" | "storage" | "exit" | "external"
    source_file: str = ""
    description: str = ""


@dataclass
class DataFlowEdge:
    """A directed edge connecting two DataFlowNodes."""
    from_id: str
    to_id: str
    label: str = ""
    data_type: str = ""     # e.g., "JSON", "DB row", "event", "HTTP"


@dataclass
class DataFlowGraph:
    """A named data flow graph for a specific business flow."""
    name: str
    description: str
    nodes: List[DataFlowNode] = field(default_factory=list)
    edges: List[DataFlowEdge] = field(default_factory=list)
    mermaid_diagram: str = ""   # Pre-rendered Mermaid graph


class DataFlowTracer:
    """
    Uses LLM to identify and map data flows within a repository.

    Usage::

        tracer = DataFlowTracer(provider, repo)
        flows = tracer.trace(file_tree, readme, lang="ko")
        md = tracer.render_markdown(flows, lang="ko")
    """

    def __init__(self, provider, repo):
        self._provider = provider
        self._repo = repo

    def trace(
        self,
        file_tree: str,
        readme: str,
        lang: str = "en",
    ) -> List[DataFlowGraph]:
        """Run LLM-based data flow analysis and return list of flow graphs."""
        from cli.pipeline.structure_planner import LANGUAGE_NAMES
        language_name = LANGUAGE_NAMES.get(lang, "English")

        prompt = DATA_FLOW_PROMPT.format(
            file_tree=file_tree,
            readme=readme,
            language_name=language_name,
        )

        try:
            raw = self._provider.generate(prompt)
            return self._parse(raw)
        except Exception as e:
            logger.warning(f"Data flow trace failed: {e}")
            return []

    def _parse(self, raw: str) -> List[DataFlowGraph]:
        """Parse LLM JSON response into DataFlowGraph list."""
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)

        try:
            match = re.search(r"\[.*\]", clean, re.DOTALL)
            if not match:
                # Try as single object
                match = re.search(r"\{.*\}", clean, re.DOTALL)
                if match:
                    data = [json.loads(match.group())]
                else:
                    return self._fallback_flow(raw)
            else:
                data = json.loads(match.group())
        except json.JSONDecodeError as e:
            logger.warning(f"Data flow JSON parse error: {e}")
            return self._fallback_flow(raw)

        flows = []
        for item in data:
            nodes = [
                DataFlowNode(
                    id=n.get("id", f"node_{i}"),
                    label=n.get("label", ""),
                    node_type=n.get("type", "process"),
                    source_file=n.get("source_file", ""),
                    description=n.get("description", ""),
                )
                for i, n in enumerate(item.get("nodes", []))
            ]
            edges = [
                DataFlowEdge(
                    from_id=e.get("from", ""),
                    to_id=e.get("to", ""),
                    label=e.get("label", ""),
                    data_type=e.get("data_type", ""),
                )
                for e in item.get("edges", [])
            ]
            mermaid = self._build_mermaid(nodes, edges)
            flows.append(DataFlowGraph(
                name=item.get("name", "Data Flow"),
                description=item.get("description", ""),
                nodes=nodes,
                edges=edges,
                mermaid_diagram=mermaid,
            ))
        return flows

    def _build_mermaid(
        self, nodes: List[DataFlowNode], edges: List[DataFlowEdge]
    ) -> str:
        """Generate a Mermaid flowchart from nodes and edges."""
        type_shape = {
            "entry": '(["{label}"])',
            "process": '["{label}"]',
            "storage": '[("{label}")]',
            "exit": '(["{label}"])',
            "external": '{{"{label}"}}',
        }
        lines = ["graph TD"]
        for node in nodes:
            shape_tmpl = type_shape.get(node.node_type, '["{label}"]')
            shape = shape_tmpl.format(label=node.label.replace('"', "'"))
            lines.append(f"    {node.id}{shape}")

        for edge in edges:
            arrow = f"-- {edge.label} -->" if edge.label else "-->"
            lines.append(f"    {edge.from_id} {arrow} {edge.to_id}")

        return "\n".join(lines)

    def _fallback_flow(self, raw: str) -> List[DataFlowGraph]:
        """Return a simple fallback when JSON parsing fails."""
        return [DataFlowGraph(
            name="System Data Flow",
            description=raw[:800],
            mermaid_diagram="graph TD\n    A[Data Entry] --> B[Processing] --> C[Storage]",
        )]

    def render_markdown(self, flows: List[DataFlowGraph], lang: str = "en") -> str:
        """Render data flow graphs to markdown with Mermaid diagrams."""
        if not flows:
            return ""

        lines = [
            "## Data Flow Analysis",
            "",
            "This section traces how data moves through the system — from entry points "
            "through processing layers to storage and external outputs.",
            "",
        ]

        for flow in flows:
            lines += [
                f"### {flow.name}",
                "",
                flow.description,
                "",
            ]
            if flow.mermaid_diagram:
                lines += [
                    "```mermaid",
                    flow.mermaid_diagram,
                    "```",
                    "",
                ]

            # Node table
            if flow.nodes:
                lines += [
                    "| Component | Type | Description |",
                    "|-----------|------|-------------|",
                ]
                for node in flow.nodes:
                    emoji = {
                        "entry": "📥",
                        "process": "⚙️",
                        "storage": "🗄️",
                        "exit": "📤",
                        "external": "🌐",
                    }.get(node.node_type, "📦")
                    src = f"`{node.source_file}`" if node.source_file else "—"
                    desc = node.description or "—"
                    lines.append(f"| {emoji} **{node.label}** | {node.node_type} | {desc} |")
                lines.append("")

        return "\n".join(lines)
