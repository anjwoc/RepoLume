"""
MCP Manager — orchestrates all MCP clients and assembles context for each wiki page.

Reads configuration from ~/.localwiki/mcp-config.yaml (or path override).
Runs all enabled MCP clients in parallel for efficiency.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = Path.home() / ".localwiki" / "mcp-config.yaml"


def load_config(config_path: str | Path | None = None) -> dict:
    """Load mcp-config.yaml, returning an empty dict if not found."""
    path = Path(config_path) if config_path else _DEFAULT_CONFIG
    if not path.is_file():
        logger.info(f"MCP config not found at {path} — all MCP sources disabled")
        return {}
    try:
        import yaml  # pyyaml
        with open(path) as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        logger.warning("pyyaml not installed — MCP config not loaded. pip install pyyaml")
        return {}
    except Exception as e:
        logger.warning(f"Failed to load MCP config {path}: {e}")
        return {}


class MCPManager:
    """
    Central orchestrator for all MCP data sources.

    Usage::

        mgr = MCPManager.from_config()
        ctx = mgr.collect_context(
            repo_path="./my-repo",
            page_topic="Authentication",
            page_files=["src/auth/token_service.py"],
        )
        # ctx is a SourcedContext with content + provenance
    """

    def __init__(self, config: dict):
        self._config = config
        self._db_clients = self._init_db_clients()
        self._atlassian_client = self._init_atlassian()
        self._github_client = self._init_github()

    @classmethod
    def from_config(cls, config_path: str | Path | None = None) -> "MCPManager":
        """Create an MCPManager from the config file."""
        return cls(load_config(config_path))

    # ── Public API ────────────────────────────────────────────────────────────

    def collect_context(
        self,
        repo_path: str,
        page_topic: str,
        page_files: list[str] | None = None,
    ) -> "SourcedContext":
        """
        Run all enabled MCP clients in parallel and return a merged SourcedContext.

        Each enabled MCP source contributes context blocks with provenance.
        """
        from cli.pipeline.source_tracker import ContextAssembler, SourcedContext

        assembler = ContextAssembler()
        futures = {}

        with ThreadPoolExecutor(max_workers=4) as executor:
            # Database MCP clients
            for db_client in self._db_clients:
                f = executor.submit(
                    db_client.get_schema_context, page_topic
                )
                futures[f] = f"db:{db_client._config.db_type}"

            # Atlassian
            if self._atlassian_client:
                f = executor.submit(
                    self._atlassian_client.get_project_context, page_topic
                )
                futures[f] = "atlassian"

            # GitHub (auto-detect remote)
            if self._github_client:
                from cli.mcp.github_mcp import detect_github_remote
                gh_info = detect_github_remote(repo_path)
                owner = gh_info[0] if gh_info else None
                repo = gh_info[1] if gh_info else None
                f = executor.submit(
                    self._github_client.get_repo_context,
                    page_topic, owner, repo,
                )
                futures[f] = "github"

            # Collect results
            for future in as_completed(futures, timeout=60):
                source_name = futures[future]
                try:
                    ctx = future.result()
                    if ctx:
                        assembler.add(ctx)
                        logger.info(f"MCP {source_name}: {len(ctx.content)} chars")
                except Exception as e:
                    logger.warning(f"MCP {source_name} failed: {e}")

        return assembler.build()

    def status(self) -> dict[str, bool]:
        """Return enabled/available status of each MCP source."""
        status = {}
        for client in self._db_clients:
            key = f"db_{client._config.db_type}"
            status[key] = client._config.enabled and client.available
        if self._atlassian_client:
            status["atlassian"] = self._atlassian_client._config.enabled
        if self._github_client:
            status["github"] = self._github_client._config.enabled and self._github_client.available
        return status

    def print_status(self) -> None:
        """Print human-readable status of all MCP sources."""
        print("\n🔌 MCP Source Status:")
        for name, ok in self.status().items():
            icon = "✅" if ok else "⭕"
            print(f"  {icon} {name}")
        active = sum(1 for v in self.status().values() if v)
        print(f"\n  Active: {active}/{len(self.status())} sources")

    # ── Init helpers ──────────────────────────────────────────────────────────

    def _init_db_clients(self) -> list:
        from cli.mcp.db_mcp import DatabaseMCPClient, DBConfig
        clients = []
        db_cfg = self._config.get("databases", {})

        db_type_map = {
            "postgresql": "postgresql",
            "mysql":      "mysql",
            "mssql":      "mssql",
            "mariadb":    "mariadb",
            "oracle":     "oracle",
        }
        for key, db_type in db_type_map.items():
            section = db_cfg.get(key, {})
            if not section:
                continue
            cfg = DBConfig(
                db_type=db_type,
                connection_string=section.get("connection_string", ""),
                enabled=section.get("enabled", False),
                display_name=section.get("display_name", db_type.upper()),
            )
            clients.append(DatabaseMCPClient(cfg))
        return clients

    def _init_atlassian(self):
        from cli.mcp.atlassian_mcp import AtlassianMCPClient, AtlassianConfig
        section = self._config.get("atlassian", {})
        if not section or not section.get("enabled"):
            return None
        mode = section.get("mode", "cloud")
        cloud = section.get("cloud", {})
        dc = section.get("datacenter", {})
        cfg = AtlassianConfig(
            enabled=True,
            mode=mode,
            cloud_mcp_url=cloud.get("mcp_url", "https://mcp.atlassian.com/v1/sse"),
            jira_url=dc.get("base_url", ""),
            confluence_url=dc.get("confluence_url", ""),
            pat=os.path.expandvars(dc.get("pat", "")),
            jira_project=section.get("jira_project", ""),
            space_key=section.get("space_key", ""),
        )
        return AtlassianMCPClient(cfg)

    def _init_github(self):
        from cli.mcp.github_mcp import GitHubMCPClient, GitHubConfig
        section = self._config.get("github", {})
        if not section or not section.get("enabled"):
            return None
        mode = section.get("mode", "docker")
        remote_cfg = section.get("remote", {})
        local_cfg = section.get("local", {})
        pat = os.path.expandvars(local_cfg.get("token", ""))
        cfg = GitHubConfig(
            enabled=True,
            mode=mode,
            pat=pat or os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", ""),
            owner=section.get("owner", ""),
            repo=section.get("repo", ""),
            toolsets=section.get("toolsets", None),
        )
        return GitHubMCPClient(cfg)
