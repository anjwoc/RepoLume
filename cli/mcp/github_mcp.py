"""
GitHub MCP Client — official GitHub MCP server.

Two modes:
  1. Remote (recommended, GitHub Copilot 구독):
     Endpoint: https://api.githubcopilot.com/mcp/
     OAuth authentication — no PAT needed.

  2. Local Docker:
     Image: ghcr.io/github/github-mcp-server
     Requires: Docker + GITHUB_PERSONAL_ACCESS_TOKEN

  3. Local binary (go build from source):
     https://github.com/github/github-mcp-server

Source: github/github-mcp-server (MIT License)
        https://github.com/github/github-mcp-server
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
class GitHubConfig:
    """GitHub MCP connection configuration."""
    enabled: bool = False
    mode: str = "local"            # "local" | "docker"

    # Local mode (binary)
    binary_path: str = ""

    # Docker mode
    docker_image: str = "ghcr.io/github/github-mcp-server"
    pat: str = ""                  # Falls back to GITHUB_PERSONAL_ACCESS_TOKEN env

    # Filter settings
    owner: str = ""                # GitHub org/user
    repo: str = ""                 # repo name (auto-detected from git remote)

    # Toolset (reduce LLM context by only loading needed tools)
    toolsets: list[str] = None     # None = all; or ["repos", "issues", "pull_requests"]

    def __post_init__(self):
        if self.toolsets is None:
            self.toolsets = ["repos", "issues", "pull_requests", "code_security"]


class GitHubMCPClient:
    """
    Fetches PR history, issues, and code context from GitHub MCP.

    Provides developer intent and code change history that greatly
    enriches wiki documentation with 'why' context.
    """

    def __init__(self, config: GitHubConfig):
        self._config = config

    @property
    def available(self) -> bool:
        if not self._config.enabled:
            return False
        if self._config.mode == "docker":
            return shutil.which("docker") is not None
        return (
            bool(self._config.binary_path and os.path.isfile(self._config.binary_path))
            or shutil.which("github-mcp-server") is not None
        )

    def get_repo_context(
        self,
        topic: str,
        owner: str | None = None,
        repo: str | None = None,
        max_prs: int = 10,
        max_issues: int = 10,
    ) -> SourcedContext | None:
        """
        Fetch recent PRs and issues related to `topic`.
        Returns SourcedContext with provenance, or None if unavailable.
        """
        if not self._config.enabled:
            return None
        if not self.available:
            logger.warning(
                "GitHub MCP not available. "
                "Install: docker pull ghcr.io/github/github-mcp-server"
            )
            return None

        _owner = owner or self._config.owner
        _repo = repo or self._config.repo
        if not _owner or not _repo:
            logger.warning("GitHub MCP: owner and repo must be set")
            return None

        try:
            return self._fetch_context(topic, _owner, _repo, max_prs, max_issues)
        except MCPError as e:
            logger.warning(f"GitHub MCP error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected GitHub MCP error: {e}")
            return None

    def _fetch_context(
        self, topic: str, owner: str, repo: str, max_prs: int, max_issues: int
    ) -> SourcedContext | None:
        cmd = self._build_command()
        content_parts: list[str] = []
        sources: list[DataSource] = []
        repo_url = f"https://github.com/{owner}/{repo}"

        with MCPStdioClient(cmd, timeout=30) as client:
            # ── Pull Requests ──────────────────────────────────────────────
            try:
                prs_raw = client.call_tool("list_pull_requests", {
                    "owner": owner,
                    "repo": repo,
                    "state": "all",
                    "per_page": max_prs,
                })
                if prs_raw:
                    content_parts.append(f"## GitHub PR 이력\n\n{prs_raw}")
                    sources.append(DataSource(
                        type="github",
                        name=f"GitHub PRs ({owner}/{repo})",
                        url=f"{repo_url}/pulls",
                        excerpt=f"최근 {max_prs}개 PR 내용",
                        metadata={"owner": owner, "repo": repo, "type": "pull_requests"},
                    ))
            except MCPError as e:
                logger.debug(f"PR fetch failed: {e}")

            # ── Issues ────────────────────────────────────────────────────
            try:
                issues_raw = client.call_tool("search_issues", {
                    "q": f"repo:{owner}/{repo} {topic} in:title,body",
                    "per_page": max_issues,
                })
                if issues_raw:
                    content_parts.append(f"## GitHub 이슈\n\n{issues_raw}")
                    sources.append(DataSource(
                        type="github",
                        name=f"GitHub Issues ({owner}/{repo})",
                        url=f"{repo_url}/issues",
                        excerpt=f"검색어: {topic}",
                        metadata={"owner": owner, "repo": repo, "type": "issues"},
                    ))
            except MCPError as e:
                logger.debug(f"Issue search failed: {e}")

        if not content_parts:
            return None

        return SourcedContext(
            content="\n\n".join(content_parts),
            sources=sources,
            context_score=10,
        )

    def check_repo_exists(self, owner: str, repo: str) -> bool:
        """Return False only if GitHub MCP explicitly says the repo doesn't exist (404).
        Returns True for all other outcomes (auth errors, timeouts, MCP unavailable)."""
        if not self._config.enabled or not self.available:
            return True
        try:
            cmd = self._build_command()
            with MCPStdioClient(cmd, timeout=10) as client:
                client.call_tool("list_pull_requests", {
                    "owner": owner, "repo": repo, "state": "closed", "per_page": 1,
                })
            return True
        except MCPError as e:
            err = str(e).lower()
            if "404" in err or "not found" in err or "does not exist" in err:
                return False
            return True
        except Exception:
            return True

    def validate_file_paths(
        self,
        owner: str,
        repo: str,
        paths: list[str],
    ) -> dict[str, bool]:
        """
        Check which file paths exist in the GitHub repo.

        Returns {path: exists} — paths absent from the repo get False.
        Silently returns all-False if GitHub MCP is unavailable.
        """
        if not self._config.enabled or not self.available:
            return {p: False for p in paths}
        if not paths:
            return {}

        result: dict[str, bool] = {}
        cmd = self._build_command()
        try:
            with MCPStdioClient(cmd, timeout=30) as client:
                for path in paths:
                    if not path:
                        continue
                    try:
                        client.call_tool("get_file_contents", {
                            "owner": owner,
                            "repo": repo,
                            "path": path,
                        })
                        result[path] = True
                    except MCPError:
                        result[path] = False
        except Exception as e:
            logger.warning(f"validate_file_paths error: {e}")
            for p in paths:
                result.setdefault(p, False)
        return result

    def _build_command(self) -> list[str]:
        pat = self._config.pat or os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")

        if self._config.mode == "docker":
            cmd = [
                "docker", "run", "-i", "--rm",
                "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
            ]
            if self._config.toolsets:
                cmd += ["--toolsets", ",".join(self._config.toolsets)]
            cmd.append(self._config.docker_image)
            # Pass env
            env = os.environ.copy()
            env["GITHUB_PERSONAL_ACCESS_TOKEN"] = pat
            return cmd

        # Local binary
        binary = self._config.binary_path or shutil.which("github-mcp-server") or "github-mcp-server"
        cmd = [binary, "stdio"]
        if self._config.toolsets:
            cmd += ["--toolsets", ",".join(self._config.toolsets)]
        return cmd


def detect_github_remote(repo_path: str) -> tuple[str, str] | None:
    """
    Auto-detect GitHub owner/repo from git remote URL.

    Returns (owner, repo) or None if not a GitHub repo.
    """
    import subprocess
    import re
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, cwd=repo_path, timeout=5,
        )
        url = result.stdout.strip()
        # Match github.com URLs: https://github.com/owner/repo or git@github.com:owner/repo
        m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
        if m:
            return m.group(1), m.group(2)
    except Exception:
        pass
    return None
