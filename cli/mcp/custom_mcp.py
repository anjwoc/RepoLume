"""Custom / Enterprise MCP Client.

Loads internal MCP servers from the `custom_mcps` section of
~/.localwiki/mcp-config.yaml.

Example yaml section::

    custom_mcps:
      oracle_internal:
        command: ["sql", "/nolog", "-mcp"]
        env: {}
        edition: custom
        enabled: true
        description: "Oracle SQLcl MCP (internal)"
      meta_mcp:
        command: ["python", "-m", "meta_mcp_server"]
        env: { META_API_TOKEN: "${META_API_TOKEN}" }
        edition: custom
        enabled: true
        description: "Meta internal MCP"

Each client wraps MCPStdioClient and exposes a simple get_context() call.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class CustomMCPConfig:
    key: str
    command: list[str]
    env: dict[str, str] = field(default_factory=dict)
    edition: str = "custom"
    enabled: bool = True
    description: str = ""

    def resolved_env(self) -> dict[str, str]:
        """Expand environment variable references in env values."""
        return {k: os.path.expandvars(v) for k, v in self.env.items()}


class CustomMCPClient:
    """
    Generic command-based MCP client for internal/enterprise MCPs.

    Reuses MCPStdioClient — no base_client.py changes required.
    Supports any MCP server that speaks JSON-RPC 2.0 over stdio.
    """

    def __init__(self, config: CustomMCPConfig):
        self._config = config

    @property
    def available(self) -> bool:
        """True if the first token of the command is on PATH."""
        import shutil
        return shutil.which(self._config.command[0]) is not None

    def get_context(self, topic: str = "", max_chars: int = 4000) -> str:
        """
        Call list_tools then call the first suitable tool for context.

        Falls back gracefully if the server is unavailable or returns an error.
        Returns a plain-text context string (empty if nothing useful found).
        """
        if not self._config.enabled or not self.available:
            return ""
        try:
            return self._fetch(topic, max_chars)
        except Exception as e:
            logger.warning("CustomMCP %s get_context error: %s", self._config.key, e)
            return ""

    def _fetch(self, topic: str, max_chars: int) -> str:
        from cli.mcp.base_client import MCPStdioClient

        # Inject custom env vars by temporarily patching os.environ
        extra = self._config.resolved_env()
        old_vals = {}
        try:
            for k, v in extra.items():
                old_vals[k] = os.environ.get(k)
                os.environ[k] = v

            with MCPStdioClient(self._config.command, timeout=20) as client:
                # List available tools and pick the first safe read tool
                try:
                    tools_raw = client._send("tools/list", {})
                    tools: list[dict[str, Any]] = (tools_raw or {}).get("tools", [])
                except Exception:
                    tools = []

                if not tools:
                    return ""

                safe_tools = [t for t in tools if not any(
                    w in t.get("name", "").lower()
                    for w in ("delete", "drop", "truncate", "write", "create", "update", "insert")
                )]
                if not safe_tools:
                    return ""

                tool = safe_tools[0]
                tool_name = tool["name"]
                args: dict[str, Any] = {}

                schema = (tool.get("inputSchema") or {}).get("properties", {})
                for param in ("query", "topic", "search", "keyword", "filter"):
                    if param in schema and topic:
                        args[param] = topic
                        break

                result = client.call_tool(tool_name, args)
                return result[:max_chars] if result else ""
        finally:
            for k, old in old_vals.items():
                if old is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = old


def load_custom_mcps(config: dict) -> list[CustomMCPClient]:
    """Parse the `custom_mcps` section of mcp-config.yaml into clients."""
    section = config.get("custom_mcps", {})
    clients = []
    for key, cfg in (section or {}).items():
        if not isinstance(cfg, dict):
            continue
        if not cfg.get("enabled", True):
            continue
        cmd = cfg.get("command", [])
        if not cmd:
            logger.warning("CustomMCP %s: missing 'command', skipping", key)
            continue
        clients.append(CustomMCPClient(CustomMCPConfig(
            key=key,
            command=cmd,
            env=cfg.get("env") or {},
            edition=cfg.get("edition", "custom"),
            enabled=cfg.get("enabled", True),
            description=cfg.get("description", ""),
        )))
    return clients
