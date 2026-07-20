"""
Atlassian MCP Client — Jira + Confluence via official Remote MCP Server.

Two modes:
  1. Cloud (recommended): Remote MCP at https://mcp.atlassian.com/v1/sse
     Uses OAuth 2.1 — no PAT needed. Enable in:
     Atlassian Admin → Settings → Products → Remote MCP server

  2. DataCenter / On-Prem: mcp-atlassian package via uvx
     Uses Personal Access Token (PAT).
     Install: pip install mcp-atlassian

Source:
  - Atlassian Remote MCP: https://www.atlassian.com/platform/marketplace/apps/remote-mcp
  - mcp-atlassian (community): https://github.com/sooperset/mcp-atlassian
"""
from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass

from cli.mcp.base_client import MCPStdioClient, MCPError
from cli.pipeline.source_tracker import DataSource, SourcedContext

logger = logging.getLogger(__name__)


@dataclass
class AtlassianConfig:
    """Atlassian connection configuration."""
    enabled: bool = False
    mode: str = "cloud"            # "cloud" | "datacenter"

    # Cloud mode
    cloud_mcp_url: str = "https://mcp.atlassian.com/v1/sse"

    # DataCenter mode
    jira_url: str = ""
    confluence_url: str = ""
    pat: str = ""                  # Personal Access Token

    # Filter settings
    jira_project: str = ""        # e.g. "PROJ" — limit to this project
    space_key: str = ""            # Confluence space key


class AtlassianMCPClient:
    """
    Fetches Jira issues and Confluence pages to enrich wiki context.

    Cloud mode uses the official Atlassian Remote MCP (SSE-based).
    DataCenter mode uses the community mcp-atlassian stdio server.
    """

    def __init__(self, config: AtlassianConfig):
        self._config = config

    @property
    def available(self) -> bool:
        if not self._config.enabled:
            return False
        if self._config.mode == "cloud":
            # Cloud mode uses HTTP SSE — always available if network is up
            # For now, check uvx/mcp-atlassian as fallback
            return True
        # DataCenter: needs uvx or mcp-atlassian installed
        return shutil.which("uvx") is not None or shutil.which("mcp-atlassian") is not None

    def get_project_context(
        self,
        topic: str,
        max_issues: int = 10,
        max_pages: int = 5,
    ) -> SourcedContext | None:
        """
        Fetch Jira issues and Confluence pages related to `topic`.
        Returns SourcedContext with provenance, or None if unavailable.
        """
        if not self._config.enabled:
            return None

        try:
            return self._fetch_context(topic, max_issues, max_pages)
        except MCPError as e:
            logger.warning(f"Atlassian MCP error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected Atlassian MCP error: {e}")
            return None

    def _fetch_context(self, topic: str, max_issues: int, max_pages: int) -> SourcedContext:
        cmd = self._build_command()
        content_parts: list[str] = []
        sources: list[DataSource] = []

        with MCPStdioClient(cmd, timeout=30) as client:
            # ── Jira issues ──────────────────────────────────────────────
            jira_query = f'text ~ "{topic}"'
            if self._config.jira_project:
                jira_query = f'project = "{self._config.jira_project}" AND {jira_query}'
            jira_query += f" ORDER BY updated DESC"

            try:
                issues_raw = client.call_tool("jira_search_issues", {
                    "jql": jira_query,
                    "maxResults": max_issues,
                    "fields": "summary,status,description,priority",
                })
                if issues_raw:
                    content_parts.append(
                        f"## Jira 컨텍스트\n\n{issues_raw}"
                    )
                    sources.append(DataSource(
                        type="jira",
                        name=f"Jira ({self._config.jira_project or 'all'})",
                        url=self._config.jira_url or self._config.cloud_mcp_url,
                        excerpt=f"검색어: {topic}, 결과: {len(issues_raw.splitlines())}줄",
                        metadata={"query": jira_query},
                    ))
            except MCPError as e:
                logger.debug(f"Jira search failed: {e}")

            # ── Confluence pages ──────────────────────────────────────────
            try:
                cf_args: dict = {
                    "query": topic,
                    "limit": max_pages,
                }
                if self._config.space_key:
                    cf_args["space_key"] = self._config.space_key

                pages_raw = client.call_tool("confluence_search", cf_args)
                if pages_raw:
                    content_parts.append(
                        f"## Confluence 문서\n\n{pages_raw}"
                    )
                    sources.append(DataSource(
                        type="confluence",
                        name=f"Confluence ({self._config.space_key or 'all spaces'})",
                        url=self._config.confluence_url or self._config.cloud_mcp_url,
                        excerpt=f"검색어: {topic}, 결과: {len(pages_raw.splitlines())}줄",
                        metadata={"query": topic},
                    ))
            except MCPError as e:
                logger.debug(f"Confluence search failed: {e}")

        if not content_parts:
            return None

        return SourcedContext(
            content="\n\n".join(content_parts),
            sources=sources,
            context_score=15,
        )

    def _build_command(self) -> list[str]:
        if self._config.mode == "datacenter":
            pat = self._config.pat or os.environ.get("ATLASSIAN_PAT", "")
            return [
                "uvx", "mcp-atlassian",
                "--jira-url", self._config.jira_url,
                "--confluence-url", self._config.confluence_url,
                "--personal-token", pat,
            ]

        # Cloud: use mcp-atlassian with OAuth (token from environment)
        # The Atlassian Remote MCP (mcp.atlassian.com) is SSE-based and
        # not directly usable as stdio. mcp-atlassian package supports Cloud too.
        return [
            "uvx", "mcp-atlassian",
            "--transport", "stdio",
            "--cloud",
        ]
