"""
MCP client unit tests — no live MCP servers required.

Tests cover:
  - Config validation and command building
  - `available` property logic (mocked shutil.which)
  - Table-list parsing
  - Topic-relevance scoring
  - GitHub remote URL detection
  - MCPManager status with empty/partial config
  - /api/mcp/test endpoint logic (prerequisites + config checks)
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ─── DatabaseMCPClient ────────────────────────────────────────────────────────

from cli.mcp.db_mcp import DatabaseMCPClient, DBConfig, _filter_relevant_tables


def _make_db_client(db_type="postgresql", enabled=True, connection_string="postgresql://user:pass@localhost:5432/mydb"):
    return DatabaseMCPClient(DBConfig(db_type=db_type, connection_string=connection_string, enabled=enabled))


class TestDBConfig:
    def test_display_name_defaults_to_uppercase_type(self):
        cfg = DBConfig(db_type="postgresql", connection_string="...")
        assert cfg.display_name == "POSTGRESQL"

    def test_explicit_display_name_preserved(self):
        cfg = DBConfig(db_type="mysql", connection_string="...", display_name="Production MySQL")
        assert cfg.display_name == "Production MySQL"


class TestDatabaseMCPClientAvailability:
    def test_available_true_when_npx_found(self):
        client = _make_db_client()
        with patch("shutil.which", return_value="/usr/local/bin/npx"):
            assert client.available is True

    def test_available_false_when_npx_missing(self):
        client = _make_db_client()
        with patch("shutil.which", return_value=None):
            assert client.available is False

    def test_oracle_checks_sql_binary(self):
        client = _make_db_client(db_type="oracle")
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/sql" if x == "sql" else None):
            assert client.available is True

    def test_disabled_client_returns_none_for_schema(self):
        client = _make_db_client(enabled=False)
        assert client.get_schema_context("topic") is None


class TestDatabaseMCPClientCommandBuilding:
    def test_postgres_command_uses_dbhub(self):
        client = _make_db_client(db_type="postgresql", connection_string="postgresql://u:p@host:5432/db")
        cmd = client._build_command()
        assert cmd[:3] == ["npx", "-y", "dbhub"]
        assert "--db-type" in cmd
        assert "postgresql" in cmd
        assert "--connection-string" in cmd

    def test_mysql_command_uses_dbhub(self):
        client = _make_db_client(db_type="mysql", connection_string="mysql://u:p@host:3306/db")
        cmd = client._build_command()
        assert "mysql" in cmd

    def test_oracle_command_uses_sql_mcp(self):
        client = _make_db_client(db_type="oracle", connection_string="")
        cmd = client._build_command()
        assert cmd == ["sql", "/nolog", "-mcp"]


class TestTableListParsing:
    def test_parses_plain_table_names(self):
        raw = "users\norders\nproducts"
        tables = DatabaseMCPClient._parse_table_list(raw)
        assert tables == ["users", "orders", "products"]

    def test_skips_separator_lines(self):
        raw = "---\nusers\n+----+\norders\n"
        tables = DatabaseMCPClient._parse_table_list(raw)
        assert "users" in tables
        assert "orders" in tables
        # separator lines skipped
        assert "---" not in tables

    def test_skips_header_words(self):
        raw = "table\nTables\nusers\norders"
        tables = DatabaseMCPClient._parse_table_list(raw)
        assert "table" not in tables
        assert "users" in tables

    def test_empty_input(self):
        assert DatabaseMCPClient._parse_table_list("") == []


class TestFilterRelevantTables:
    def test_relevant_tables_first(self):
        tables = ["order_items", "users", "order_header", "products"]
        result = _filter_relevant_tables(tables, "order")
        assert result[0].startswith("order")
        assert result[1].startswith("order")

    def test_no_match_returns_all_alphabetical(self):
        tables = ["zebra", "alpha", "middle"]
        result = _filter_relevant_tables(tables, "xyz_no_match")
        assert result == sorted(tables)

    def test_empty_tables(self):
        assert _filter_relevant_tables([], "anything") == []


# ─── GitHubMCPClient ─────────────────────────────────────────────────────────

from cli.mcp.github_mcp import GitHubMCPClient, GitHubConfig, detect_github_remote


def _make_github_client(mode="docker", pat="ghp_test", enabled=True):
    return GitHubMCPClient(GitHubConfig(enabled=enabled, mode=mode, pat=pat))


class TestGitHubMCPClientAvailability:
    def test_docker_mode_available_when_docker_found(self):
        client = _make_github_client(mode="docker")
        with patch("shutil.which", return_value="/usr/bin/docker"):
            assert client.available is True

    def test_docker_mode_unavailable_when_docker_missing(self):
        client = _make_github_client(mode="docker")
        with patch("shutil.which", return_value=None):
            assert client.available is False

    def test_local_mode_available_via_which(self):
        client = _make_github_client(mode="local")
        with patch("shutil.which", side_effect=lambda x: "/usr/local/bin/github-mcp-server" if x == "github-mcp-server" else None):
            assert client.available is True

    def test_disabled_always_unavailable(self):
        client = _make_github_client(enabled=False)
        assert client.available is False


class TestGitHubMCPCommandBuilding:
    def test_docker_command_structure(self):
        client = _make_github_client(mode="docker", pat="ghp_abc")
        cmd = client._build_command()
        assert "docker" in cmd
        assert "ghcr.io/github/github-mcp-server" in cmd

    def test_local_command_uses_binary_and_stdio(self):
        client = _make_github_client(mode="local")
        with patch("shutil.which", return_value="/usr/local/bin/github-mcp-server"):
            cmd = client._build_command()
        assert "stdio" in cmd

    def test_toolsets_included_in_command(self):
        cfg = GitHubConfig(enabled=True, mode="docker", toolsets=["issues", "pull_requests"])
        client = GitHubMCPClient(cfg)
        cmd = client._build_command()
        assert "--toolsets" in cmd


class TestDetectGitHubRemote:
    def test_https_url_parsed(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(stdout="https://github.com/myorg/myrepo.git\n", returncode=0)
            result = detect_github_remote("/some/path")
        assert result == ("myorg", "myrepo")

    def test_ssh_url_parsed(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(stdout="git@github.com:myorg/myrepo.git\n", returncode=0)
            result = detect_github_remote("/some/path")
        assert result == ("myorg", "myrepo")

    def test_non_github_url_returns_none(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(stdout="https://gitlab.com/org/repo.git\n", returncode=0)
            result = detect_github_remote("/some/path")
        assert result is None

    def test_subprocess_exception_returns_none(self):
        with patch("subprocess.run", side_effect=Exception("timeout")):
            result = detect_github_remote("/some/path")
        assert result is None


# ─── AtlassianMCPClient ───────────────────────────────────────────────────────

from cli.mcp.atlassian_mcp import AtlassianMCPClient, AtlassianConfig


def _make_atlassian_client(mode="datacenter", enabled=True):
    return AtlassianMCPClient(AtlassianConfig(
        enabled=enabled, mode=mode,
        jira_url="https://jira.example.com",
        confluence_url="https://confluence.example.com",
        pat="test_pat",
    ))


class TestAtlassianMCPClientAvailability:
    def test_cloud_mode_always_available_when_enabled(self):
        client = _make_atlassian_client(mode="cloud")
        assert client.available is True

    def test_datacenter_available_with_uvx(self):
        client = _make_atlassian_client(mode="datacenter")
        with patch("shutil.which", side_effect=lambda x: "/usr/bin/uvx" if x == "uvx" else None):
            assert client.available is True

    def test_datacenter_unavailable_without_tools(self):
        client = _make_atlassian_client(mode="datacenter")
        with patch("shutil.which", return_value=None):
            assert client.available is False

    def test_disabled_returns_none(self):
        client = _make_atlassian_client(enabled=False)
        assert client.get_project_context("topic") is None


class TestAtlassianCommandBuilding:
    def test_datacenter_command_includes_jira_url(self):
        client = _make_atlassian_client(mode="datacenter")
        cmd = client._build_command()
        assert "mcp-atlassian" in " ".join(cmd)
        assert "--jira-url" in cmd
        assert "https://jira.example.com" in cmd

    def test_cloud_command_includes_cloud_flag(self):
        client = _make_atlassian_client(mode="cloud")
        cmd = client._build_command()
        assert "--cloud" in cmd
        assert "--transport" in cmd


# ─── MCPManager ───────────────────────────────────────────────────────────────

from cli.mcp.manager import MCPManager, load_config


class TestLoadConfig:
    def test_returns_empty_dict_for_missing_file(self, tmp_path):
        result = load_config(tmp_path / "nonexistent.yaml")
        assert result == {}

    def test_returns_empty_dict_for_empty_yaml(self, tmp_path):
        f = tmp_path / "mcp-config.yaml"
        f.write_text("")
        result = load_config(f)
        assert result == {}

    def test_parses_simple_yaml(self, tmp_path):
        f = tmp_path / "mcp-config.yaml"
        f.write_text("github:\n  enabled: true\n  mode: docker\n")
        result = load_config(f)
        assert result["github"]["enabled"] is True


class TestMCPManagerStatus:
    def test_empty_config_yields_empty_status(self):
        mgr = MCPManager({})
        assert mgr.status() == {}

    def test_disabled_db_not_in_status_as_active(self):
        config = {"databases": {"postgresql": {"enabled": False, "connection_string": "postgresql://u:p@h:5432/db"}}}
        mgr = MCPManager(config)
        s = mgr.status()
        assert s.get("db_postgresql") is False

    def test_no_atlassian_section_gives_no_atlassian_key(self):
        mgr = MCPManager({})
        assert "atlassian" not in mgr.status()

    def test_no_github_section_gives_no_github_key(self):
        mgr = MCPManager({})
        assert "github" not in mgr.status()


# ─── /api/mcp/test endpoint logic ────────────────────────────────────────────

import asyncio

from api.routes.mcp import _dispatch, _build_db_connection_string, _redact_password


class TestBuildDbConnectionString:
    def test_postgres_defaults(self):
        cs = _build_db_connection_string("postgresql", {"host": "localhost", "username": "u", "password": "p", "database": "db"})
        assert cs.startswith("postgresql://u:p@localhost")
        assert "/db" in cs

    def test_missing_host_returns_empty(self):
        cs = _build_db_connection_string("postgresql", {})
        assert cs == ""

    def test_explicit_connection_string_override(self):
        cs = _build_db_connection_string("mysql", {"options": {"connectionString": "mysql://a:b@host/db"}})
        assert cs == "mysql://a:b@host/db"

    def test_default_port_used(self):
        cs = _build_db_connection_string("mysql", {"host": "db.example.com"})
        assert ":3306" in cs


class TestRedactPassword:
    def test_redacts_password_in_url(self):
        cs = "postgresql://user:supersecret@host:5432/db"
        redacted = _redact_password(cs)
        assert "supersecret" not in redacted
        assert "****" in redacted
        assert "user" in redacted
        assert "host" in redacted

    def test_empty_string(self):
        assert _redact_password("") == ""


class TestDispatchUnknownProvider:
    def test_unknown_provider_returns_not_ok(self):
        result = asyncio.run(_dispatch("notion", {}))
        assert result.ok is False
        assert "지원되지 않습니다" in result.message


class TestDispatchDBMissingHost:
    def test_missing_host_returns_error(self):
        result = asyncio.run(
            _dispatch("postgresql", {"username": "u", "password": "p"})
        )
        assert result.ok is False
        assert "Host" in result.message


class TestDispatchGitHubMissingToken:
    def test_missing_token_returns_error(self):
        with patch("shutil.which", return_value="/usr/bin/docker"):
            result = asyncio.run(
                _dispatch("github", {})
            )
        assert result.ok is False
        assert "Token" in result.message


class TestDispatchAtlassianMissingConfig:
    def test_missing_url_returns_error(self):
        with patch("shutil.which", return_value="/usr/bin/uvx"):
            result = asyncio.run(
                _dispatch("jira", {"apiToken": "tok"})
            )
        assert result.ok is False
        assert "URL" in result.message

    def test_missing_token_returns_error(self):
        with patch("shutil.which", return_value="/usr/bin/uvx"):
            result = asyncio.run(
                _dispatch("confluence", {"apiUrl": "https://my.atlassian.net"})
            )
        assert result.ok is False
        assert "Token" in result.message


# ─── CustomMCPConfig ──────────────────────────────────────────────────────────

from cli.mcp.custom_mcp import CustomMCPClient, CustomMCPConfig, load_custom_mcps


class TestCustomMCPConfig:
    def test_resolved_env_expands_variables(self, monkeypatch):
        monkeypatch.setenv("MY_TOKEN", "secret123")
        cfg = CustomMCPConfig(key="test", command=["run"], env={"TOKEN": "${MY_TOKEN}"})
        assert cfg.resolved_env()["TOKEN"] == "secret123"

    def test_resolved_env_passthrough_literal(self):
        cfg = CustomMCPConfig(key="test", command=["run"], env={"FOO": "bar"})
        assert cfg.resolved_env()["FOO"] == "bar"

    def test_resolved_env_empty(self):
        cfg = CustomMCPConfig(key="test", command=["run"])
        assert cfg.resolved_env() == {}


class TestLoadCustomMCPs:
    def test_empty_config_returns_empty_list(self):
        clients = load_custom_mcps({})
        assert clients == []

    def test_no_custom_mcps_key_returns_empty(self):
        clients = load_custom_mcps({"databases": {"postgresql": {}}})
        assert clients == []

    def test_parses_valid_entry(self):
        cfg = {
            "custom_mcps": {
                "oracle_internal": {
                    "command": ["sql", "/nolog", "-mcp"],
                    "edition": "custom",
                    "enabled": True,
                    "description": "Oracle SQLcl",
                }
            }
        }
        clients = load_custom_mcps(cfg)
        assert len(clients) == 1
        assert clients[0]._config.key == "oracle_internal"
        assert clients[0]._config.command == ["sql", "/nolog", "-mcp"]
        assert clients[0]._config.edition == "custom"

    def test_entry_without_command_skipped(self):
        cfg = {"custom_mcps": {"bad_entry": {"enabled": True}}}
        clients = load_custom_mcps(cfg)
        assert clients == []

    def test_disabled_entry_loaded_but_available_check_respected(self):
        cfg = {
            "custom_mcps": {
                "disabled_mcp": {
                    "command": ["nonexistent_cmd"],
                    "enabled": False,
                }
            }
        }
        clients = load_custom_mcps(cfg)
        assert len(clients) == 1
        assert clients[0]._config.enabled is False


class TestCustomMCPClientAvailability:
    def test_available_when_command_on_path(self):
        cfg = CustomMCPConfig(key="test", command=["sql", "/nolog", "-mcp"])
        client = CustomMCPClient(cfg)
        with patch("shutil.which", return_value="/usr/bin/sql"):
            assert client.available is True

    def test_unavailable_when_command_not_found(self):
        cfg = CustomMCPConfig(key="test", command=["nonexistent_mcp_cmd"])
        client = CustomMCPClient(cfg)
        with patch("shutil.which", return_value=None):
            assert client.available is False

    def test_get_context_returns_empty_when_disabled(self):
        cfg = CustomMCPConfig(key="test", command=["sql"], enabled=False)
        client = CustomMCPClient(cfg)
        assert client.get_context("topic") == ""

    def test_get_context_returns_empty_when_unavailable(self):
        cfg = CustomMCPConfig(key="test", command=["nonexistent_mcp_cmd"])
        client = CustomMCPClient(cfg)
        with patch("shutil.which", return_value=None):
            assert client.get_context("topic") == ""


# ─── MCPManager.collect_cross_check_context — on/off behavior ─────────────────

class TestCollectCrossCheckContextDisabled:
    """collect_cross_check_context() graceful skip when DB is disabled or missing."""

    def test_disabled_db_produces_no_results(self):
        config = {
            "databases": {
                "postgresql": {
                    "enabled": False,
                    "connection_string": "postgresql://u:p@localhost/db",
                }
            }
        }
        mgr = MCPManager(config)
        results = mgr.collect_cross_check_context(
            entities={"db_tables": ["users", "orders"], "stored_procs": ["sp_users"]},
        )
        # Disabled DB should be skipped entirely — no results, no exception
        assert isinstance(results, dict)
        db_keys = [k for k in results if "DB" in k]
        assert db_keys == []

    def test_empty_entities_skips_all_db_queries(self):
        config = {
            "databases": {
                "postgresql": {
                    "enabled": True,
                    "connection_string": "postgresql://u:p@localhost/db",
                }
            }
        }
        mgr = MCPManager(config)
        # No entities → no DB calls needed
        with patch("shutil.which", return_value=None):  # make unavailable
            results = mgr.collect_cross_check_context(entities={})
        assert results == {}

    def test_no_mcp_config_returns_empty(self):
        mgr = MCPManager({})
        results = mgr.collect_cross_check_context(entities={"db_tables": ["users"]})
        assert results == {}

    def test_mixed_enabled_disabled_only_enabled_queried(self):
        config = {
            "databases": {
                "postgresql": {
                    "enabled": True,
                    "connection_string": "postgresql://u:p@localhost/db",
                },
                "mysql": {
                    "enabled": False,
                    "connection_string": "mysql://u:p@localhost/db",
                },
            }
        }
        mgr = MCPManager(config)
        # Make postgres unavailable via shutil.which → graceful skip
        with patch("shutil.which", return_value=None):
            results = mgr.collect_cross_check_context(
                entities={"db_tables": ["users"]},
            )
        # Neither should produce results since postgres is unavailable
        mysql_keys = [k for k in results if "mysql" in k.lower()]
        assert mysql_keys == []

    def test_custom_mcp_disabled_skipped(self):
        config = {
            "custom_mcps": {
                "internal_db": {
                    "command": ["internal_mcp_tool"],
                    "enabled": False,
                }
            }
        }
        mgr = MCPManager(config)
        results = mgr.collect_cross_check_context(entities={"service_names": ["OrderService"]})
        custom_keys = [k for k in results if "Custom" in k]
        assert custom_keys == []

    def test_custom_mcp_unavailable_skipped(self):
        config = {
            "custom_mcps": {
                "internal_db": {
                    "command": ["nonexistent_internal_mcp"],
                    "enabled": True,
                }
            }
        }
        mgr = MCPManager(config)
        with patch("shutil.which", return_value=None):
            results = mgr.collect_cross_check_context(
                entities={"service_names": ["OrderService"]},
            )
        assert results == {}


class TestMCPManagerStatusWithCustom:
    def test_custom_mcps_not_included_in_status(self):
        config = {
            "custom_mcps": {
                "oracle_internal": {"command": ["sql"], "enabled": True}
            }
        }
        mgr = MCPManager(config)
        # status() only tracks community/official providers
        s = mgr.status()
        assert "oracle_internal" not in s

    def test_status_false_for_unavailable_db_even_if_enabled(self):
        config = {
            "databases": {
                "postgresql": {
                    "enabled": True,
                    "connection_string": "postgresql://u:p@localhost/db",
                }
            }
        }
        mgr = MCPManager(config)
        with patch("shutil.which", return_value=None):
            s = mgr.status()
        assert s.get("db_postgresql") is False
