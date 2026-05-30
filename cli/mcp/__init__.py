"""
MCP Package — Model Context Protocol clients for cross-source enrichment.

All clients follow the same pattern:
  1. Start the MCP server process (stdio-based JSON-RPC 2.0)
  2. Initialize (send 'initialize' handshake)
  3. Call tools to fetch structured data
  4. Return SourcedContext with provenance metadata

Usage::

    from cli.mcp import get_mcp_manager
    mgr = get_mcp_manager(config_path="~/.localwiki/mcp-config.yaml")
    ctx = mgr.collect_context(repo_path, page_topic)
"""
from __future__ import annotations

from cli.mcp.manager import MCPManager, load_config

__all__ = ["MCPManager", "load_config"]
