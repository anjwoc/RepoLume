"""
MCP Manager — orchestrates all MCP clients and assembles context for each wiki page.

Reads configuration from ~/.repolume/mcp-config.yaml (or path override).
Runs all enabled MCP clients in parallel for efficiency.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from cli.pipeline.source_tracker import SourcedContext

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = Path.home() / ".repolume" / "mcp-config.yaml"
_LEGACY_CONFIG = Path.home() / ".localwiki" / "mcp-config.yaml"


def load_config(config_path: str | Path | None = None) -> dict:
    """Load mcp-config.yaml, returning an empty dict if not found."""
    path = Path(config_path) if config_path else (
        _DEFAULT_CONFIG if _DEFAULT_CONFIG.is_file() or not _LEGACY_CONFIG.is_file()
        else _LEGACY_CONFIG
    )
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
        self._custom_clients = self._init_custom_mcps()

    @classmethod
    def from_config(cls, config_path: str | Path | None = None) -> "MCPManager":
        """Create an MCPManager from the config file."""
        return cls(load_config(config_path))

    @classmethod
    def for_project(cls, project_id: str, global_config_path: str | Path | None = None) -> "MCPManager":
        """Project-specific config first; falls back to global yaml file."""
        try:
            from api.db.store import project_settings_store
            project_cfg = project_settings_store.get(project_id, "mcp_config")
            if project_cfg and isinstance(project_cfg, dict):
                logger.info("MCP: using per-project config for %s", project_id)
                return cls(project_cfg)
        except Exception as e:
            logger.debug("MCP: project settings lookup failed (%s): %s", project_id, e)
        return cls.from_config(global_config_path)

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

    def collect_cross_check_context(
        self,
        entities: dict,
        topic_hint: str = "",
        code_snippets: list[str] | None = None,
    ) -> dict[str, str]:
        """
        Reverse-lookup MCP data from code-extracted entities.

        For each enabled DB:
          1. list_tables() → intersect with entities["db_tables"]
          2. describe_table() for each relevant table
          3. get_procedure_source() for entities["stored_procs"]

        For GitHub/Atlassian: search using service names + topic hint.

        Returns {provider_label: context_text}.
        Failures emit a skip and continue (graceful degradation).
        """
        db_tables: list[str] = entities.get("db_tables", [])
        stored_procs: list[str] = entities.get("stored_procs", [])
        service_names: list[str] = entities.get("service_names", [])
        topic = topic_hint or " ".join(service_names[:3])

        results: dict[str, str] = {}
        skipped: list[str] = []

        # ── DB cross-check ────────────────────────────────────────────────
        # If code snippets provided, only query DB types that appear in the code
        if code_snippets:
            from cli.mcp.db_mcp import DatabaseMCPClient
            detected = DatabaseMCPClient.detect_db_types(code_snippets)
            active_db_clients = [c for c in self._db_clients if not detected or c._config.db_type in detected]
            if detected and len(active_db_clients) < len(self._db_clients):
                logger.info("MCP: DB type detection narrowed %d→%d clients (detected: %s)",
                            len(self._db_clients), len(active_db_clients), detected)
        else:
            active_db_clients = self._db_clients

        for db_client in active_db_clients:
            if not db_client._config.enabled or not db_client.available:
                continue
            label = f"DB ({db_client._config.db_type})"
            try:
                parts: list[str] = []

                # Schema for relevant tables
                if db_tables:
                    from cli.mcp.base_client import MCPStdioClient
                    cmd = db_client._build_command()
                    with MCPStdioClient(cmd, timeout=30) as mcp:
                        available_raw = mcp.call_tool("list_tables", {})
                        available = set(db_client._parse_table_list(available_raw))
                        relevant = [t for t in db_tables if t in available][:15]
                        for table in relevant:
                            try:
                                desc = mcp.call_tool("describe_table", {"table": table})
                                parts.append(f"### 테이블: {table}\n```sql\n{desc}\n```")
                            except Exception as e:
                                logger.debug("describe_table %s: %s", table, e)

                # Stored procedure sources
                if stored_procs:
                    sp_text = db_client.get_procedure_source(stored_procs)
                    if sp_text:
                        parts.append(sp_text)

                if parts:
                    results[label] = "\n\n".join(parts)
                    logger.info("MCP cross-check %s: %d chars", label, len(results[label]))
            except Exception as e:
                logger.warning("MCP cross-check skipped (%s): %s", label, e)
                skipped.append(label)

        # ── GitHub cross-check ────────────────────────────────────────────
        if self._github_client and self._github_client._config.enabled:
            label = "GitHub"
            if not topic:
                skipped.append(f"{label} (엔티티 없음)")
            else:
                try:
                    ctx = self._github_client.get_repo_context(
                        topic=topic,
                        owner=self._github_client._config.owner or "",
                        repo=self._github_client._config.repo or "",
                    )
                    if ctx and ctx.content:
                        results[label] = ctx.content
                except Exception as e:
                    logger.warning("MCP cross-check skipped (%s): %s", label, e)
                    skipped.append(label)

        # ── Custom MCP cross-check ────────────────────────────────────────
        for custom_client in self._custom_clients:
            if not custom_client._config.enabled or not custom_client.available:
                continue
            label = f"Custom ({custom_client._config.key})"
            try:
                ctx = custom_client.get_context(topic=topic)
                if ctx:
                    results[label] = ctx
                    logger.info("MCP cross-check %s: %d chars", label, len(ctx))
            except Exception as e:
                logger.warning("MCP cross-check skipped (%s): %s", label, e)
                skipped.append(label)

        # ── Atlassian cross-check ─────────────────────────────────────────
        if self._atlassian_client and self._atlassian_client._config.enabled:
            label = "Atlassian"
            if not topic:
                skipped.append(f"{label} (엔티티 없음)")
            else:
                try:
                    ctx = self._atlassian_client.get_project_context(topic)
                    if ctx and ctx.content:
                        results[label] = ctx.content
                except Exception as e:
                    logger.warning("MCP cross-check skipped (%s): %s", label, e)
                    skipped.append(label)

        if skipped:
            logger.info("MCP cross-check skipped providers: %s", skipped)

        return results

    def scan_git_roots(self, project_path: str) -> list[dict]:
        """Walk project_path and return [{path, owner, repo, web_url}] for each .git found."""
        import os
        import re
        import subprocess
        roots = []
        try:
            for dirpath, dirnames, _ in os.walk(project_path):
                if ".git" in dirnames:
                    dirnames.remove(".git")  # don't recurse into .git itself
                    try:
                        result = subprocess.run(
                            ["git", "remote", "get-url", "origin"],
                            capture_output=True, text=True, cwd=dirpath, timeout=5,
                        )
                        url = result.stdout.strip()
                        m = re.search(r"[:/]([^/]+)/([^/.]+?)(?:\.git)?$", url)
                        if m:
                            roots.append({
                                "path": dirpath,
                                "owner": m.group(1),
                                "repo": m.group(2),
                                "web_url": url,
                                "valid": True,
                            })
                    except Exception:
                        pass
        except Exception:
            pass
        return roots

    def validate_git_roots(self, roots: list[dict]) -> list[dict]:
        """Add/update `valid` field by checking each repo against GitHub MCP.
        Repos that return 404 get valid=False; all others stay True."""
        if not self._github_client or not self._github_client._config.enabled:
            return roots  # no GitHub MCP — leave all valid as-is
        validated = []
        for root in roots:
            exists = self._github_client.check_repo_exists(root["owner"], root["repo"])
            validated.append({**root, "valid": exists})
        return validated

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

    def _init_custom_mcps(self) -> list:
        from cli.mcp.custom_mcp import load_custom_mcps
        return load_custom_mcps(self._config)

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
