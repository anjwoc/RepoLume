"""
Call Graph data model — ported from CodeBoarding.

원본 출처: CodeBoarding/static_analyzer/graph.py (MIT License)
Copyright 2025 CodeBoarding Team
https://github.com/CodeBoarding/CodeBoarding

이 파일은 CodeBoarding의 CallGraph, Node 구조를 LocalWiki에 맞게
의존성을 최소화하여 이식한 버전입니다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Node:
    """
    A node in the call graph representing a component, class, or function.

    Fields
    ------
    id       : unique identifier (usually fully-qualified name)
    name     : display name
    file_path: source file path
    kind     : "class" | "function" | "module" | "package"
    language : programming language
    summary  : brief description of the node (LLM-generated or docstring)
    """
    id: str
    name: str
    file_path: str = ""
    kind: str = "module"
    language: str = "python"
    summary: str = ""
    children: list["Node"] = field(default_factory=list)

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return isinstance(other, Node) and self.id == other.id

    @property
    def display(self) -> str:
        """Short label for Mermaid diagram."""
        return self.name.split(".")[-1] if "." in self.name else self.name


@dataclass
class Edge:
    """
    A directed relationship between two nodes.

    Fields
    ------
    src      : source node id
    dst      : destination node id
    label    : relationship type (e.g. "calls", "imports", "inherits")
    weight   : call frequency / importance (higher = more prominent in diagram)
    """
    src: str
    dst: str
    label: str = "calls"
    weight: float = 1.0


class CallGraph:
    """
    Directed call/dependency graph for a codebase.

    Provides filtering and clustering utilities used by SonarAnalyzer
    to generate meaningful architecture diagrams.
    """

    def __init__(self, language: str = ""):
        self.language = language
        self._nodes: dict[str, Node] = {}
        self._edges: list[Edge] = []

    # ── Mutation ─────────────────────────────────────────────────────────────

    def add_node(self, node: Node) -> None:
        self._nodes[node.id] = node

    def add_edge(self, edge: Edge) -> None:
        self._edges.append(edge)

    # ── Query ─────────────────────────────────────────────────────────────────

    @property
    def nodes(self) -> list[Node]:
        return list(self._nodes.values())

    @property
    def edges(self) -> list[Edge]:
        return self._edges

    def get_node(self, node_id: str) -> Optional[Node]:
        return self._nodes.get(node_id)

    def neighbors(self, node_id: str) -> list[Node]:
        """Return all nodes directly called by node_id."""
        return [
            self._nodes[e.dst]
            for e in self._edges
            if e.src == node_id and e.dst in self._nodes
        ]

    def callers(self, node_id: str) -> list[Node]:
        """Return all nodes that call node_id."""
        return [
            self._nodes[e.src]
            for e in self._edges
            if e.dst == node_id and e.src in self._nodes
        ]

    def subgraph_for_files(self, file_paths: list[str]) -> "CallGraph":
        """
        Return a subgraph containing only nodes whose file_path
        is in file_paths, plus edges between those nodes.
        """
        path_set = set(file_paths)
        sg = CallGraph(self.language)
        for node in self._nodes.values():
            if node.file_path in path_set:
                sg.add_node(node)
        node_ids = set(sg._nodes.keys())
        for edge in self._edges:
            if edge.src in node_ids and edge.dst in node_ids:
                sg.add_edge(edge)
        return sg

    def top_nodes_by_degree(self, n: int = 15) -> list[Node]:
        """Return the n most connected nodes (in-degree + out-degree)."""
        from collections import Counter
        degree: Counter = Counter()
        for edge in self._edges:
            degree[edge.src] += 1
            degree[edge.dst] += 1
        top_ids = [nid for nid, _ in degree.most_common(n)]
        return [self._nodes[nid] for nid in top_ids if nid in self._nodes]

    def cluster_by_file(self) -> dict[str, list[Node]]:
        """Group nodes by their file path."""
        clusters: dict[str, list[Node]] = {}
        for node in self._nodes.values():
            clusters.setdefault(node.file_path, []).append(node)
        return clusters

    def __len__(self) -> int:
        return len(self._nodes)

    def __repr__(self) -> str:
        return f"CallGraph(nodes={len(self._nodes)}, edges={len(self._edges)}, lang={self.language})"
