"""
Mermaid Diagram Generator — converts CallGraph into Mermaid LR diagrams.

원본 출처: CodeBoarding/output_generators/markdown.py (MIT License)
Copyright 2025 CodeBoarding Team
https://github.com/CodeBoarding/CodeBoarding

이 파일은 CodeBoarding의 Mermaid 다이어그램 생성 로직을
LocalWiki의 CallGraph 모델에 맞게 이식한 버전입니다.
"""
from __future__ import annotations

import re
from typing import Optional

from cli.sonar.call_graph import CallGraph, Node, Edge


def generate_mermaid(
    graph: CallGraph,
    title: str = "",
    max_nodes: int = 20,
    direction: str = "LR",
) -> str:
    """
    Generate a Mermaid graph diagram from a CallGraph.

    Parameters
    ----------
    graph      : the CallGraph to visualize
    title      : optional diagram title
    max_nodes  : cap on number of nodes (focuses on most-connected)
    direction  : "LR" (left-right) | "TD" (top-down)

    Returns
    -------
    A complete Mermaid code block as a string, ready for insertion.
    """
    nodes = _select_top_nodes(graph, max_nodes)
    if not nodes:
        return ""

    node_ids = {n.id for n in nodes}
    edges = [e for e in graph.edges if e.src in node_ids and e.dst in node_ids]

    # Deduplicate edges
    seen_edges: set[tuple[str, str]] = set()
    unique_edges: list[Edge] = []
    for edge in edges:
        key = (edge.src, edge.dst)
        if key not in seen_edges:
            seen_edges.add(key)
            unique_edges.append(edge)

    lines = ["```mermaid", f"graph {direction}"]

    if title:
        lines.append(f'    %% {title}')

    # Node definitions
    for node in nodes:
        node_key = _sanitize_id(node.id)
        label = _sanitize_label(node.name)
        shape = _node_shape(node.kind)
        lines.append(f'    {node_key}{shape[0]}"{label}"{shape[1]}')

    # Edge definitions
    for edge in unique_edges:
        src = _sanitize_id(edge.src)
        dst = _sanitize_id(edge.dst)
        if edge.label and edge.label not in ("calls", "imports"):
            lines.append(f'    {src} -- "{edge.label}" --> {dst}')
        else:
            lines.append(f'    {src} --> {dst}')

    lines.append("```")
    return "\n".join(lines)


def generate_mermaid_for_files(
    graph: CallGraph,
    file_paths: list[str],
    title: str = "",
) -> str:
    """
    Generate a focused diagram for a specific set of files.

    Extracts the subgraph for the given files, then renders it.
    """
    subgraph = graph.subgraph_for_files(file_paths)
    if len(subgraph) == 0:
        return ""
    return generate_mermaid(subgraph, title=title)


def generate_overview_diagram(graph: CallGraph) -> str:
    """
    Generate a high-level architecture overview diagram.
    Uses the top 15 most-connected nodes.
    """
    return generate_mermaid(graph, title="Architecture Overview", max_nodes=15)


def generate_cluster_diagram(graph: CallGraph, cluster_name: str, nodes: list[Node]) -> str:
    """
    Generate a diagram for one cluster (e.g. a package or directory).
    """
    if not nodes:
        return ""
    node_ids = {n.id for n in nodes}
    edges = [e for e in graph.edges if e.src in node_ids or e.dst in node_ids]

    lines = ["```mermaid", "graph LR"]
    lines.append(f'    subgraph {_sanitize_id(cluster_name)}["{cluster_name}"]')
    for node in nodes:
        nk = _sanitize_id(node.id)
        label = _sanitize_label(node.name)
        lines.append(f'        {nk}["{label}"]')
    lines.append("    end")

    for edge in edges:
        src = _sanitize_id(edge.src)
        dst = _sanitize_id(edge.dst)
        lines.append(f'    {src} --> {dst}')

    lines.append("```")
    return "\n".join(lines)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _select_top_nodes(graph: CallGraph, max_nodes: int) -> list[Node]:
    """Select the most important nodes for the diagram."""
    if len(graph.nodes) <= max_nodes:
        return graph.nodes
    return graph.top_nodes_by_degree(max_nodes)


def _sanitize_id(node_id: str) -> str:
    """Convert a node id to a valid Mermaid identifier."""
    # Replace invalid chars with underscore
    s = re.sub(r"[^\w]", "_", node_id)
    # Mermaid ids cannot start with a digit
    if s and s[0].isdigit():
        s = "n_" + s
    return s or "node"


def _sanitize_label(label: str) -> str:
    """Escape quotes in labels."""
    return label.replace('"', "'")


def _node_shape(kind: str) -> tuple[str, str]:
    """Return Mermaid shape brackets for a node kind."""
    shapes = {
        "class":    ("[", "]"),       # rectangle
        "module":   ("(", ")"),       # rounded
        "package":  ("[[", "]]"),     # subroutine
        "function": ("{", "}"),       # rhombus
        "service":  ("([", "])"),     # stadium
    }
    return shapes.get(kind, ("[", "]"))
