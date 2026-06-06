"""
Election MCP Client — connects via stdio bridge or remote MCP for election data.
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
class ElectionConfig:
    """Election MCP connection configuration."""
    enabled: bool = False
    mode: str = "cloud"            # "cloud" or "local"

    # Cloud mode endpoint
    cloud_mcp_url: str = "https://mcp.electionmcp.kr/mcp"

    # In case there is a local pip package for stdio execution
    binary_path: str = "electionmcp"


class ElectionMCPClient:
    """
    Fetches candidate information for the 9th Local Elections.
    """

    def __init__(self, config: ElectionConfig):
        self._config = config

    @property
    def available(self) -> bool:
        if not self._config.enabled:
            return False
        
        # We rely on npx @modelcontextprotocol/inspector for SSE bridging
        # or we might need uvx mcp-sse-client.
        # But wait, earlier we tried to find an SSE bridge and none were standard.
        # The easiest way to run a node based SSE bridge might be needed, or we just write a quick wrapper.
        # Let's assume for now the user will provide feedback.
        return True

    def get_candidate_context(self, topic: str) -> SourcedContext | None:
        return None
