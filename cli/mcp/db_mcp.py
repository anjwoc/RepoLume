"""
Database MCP Client — DBHub (PostgreSQL/MySQL/MSSQL/MariaDB) + Oracle SQLcl.

DBHub (https://github.com/bytebase/dbhub) is a zero-dependency MCP server
supporting multiple databases with a single install.

Oracle uses its official SQLcl MCP mode: `sql /nolog -mcp`

Source: DBHub (Apache-2.0), Oracle SQLcl MCP (Oracle License)
"""
from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from typing import Any

from cli.mcp.base_client import MCPStdioClient, MCPError
from cli.pipeline.source_tracker import DataSource, SourcedContext

logger = logging.getLogger(__name__)


@dataclass
class DBConfig:
    """Database connection configuration."""
    db_type: str          # "postgresql" | "mysql" | "mssql" | "mariadb" | "oracle"
    connection_string: str
    enabled: bool = False
    display_name: str = ""

    def __post_init__(self):
        if not self.display_name:
            self.display_name = self.db_type.upper()


class DatabaseMCPClient:
    """
    Fetches DB schema context via DBHub (or Oracle SQLcl) MCP server.

    Per the architecture decision:
    - PostgreSQL, MySQL, MSSQL, MariaDB → DBHub (single install)
    - Oracle → Oracle SQLcl `sql /nolog -mcp`
    """

    # Tools provided by DBHub
    _DBHUB_TOOLS = {
        "list_tables":    "list_tables",
        "describe_table": "describe_table",
        "query":          "execute_query",
    }

    def __init__(self, config: DBConfig):
        self._config = config

    @property
    def available(self) -> bool:
        if self._config.db_type == "oracle":
            return shutil.which("sql") is not None
        return shutil.which("npx") is not None

    def get_schema_context(
        self,
        topic_hint: str = "",
        max_tables: int = 20,
    ) -> SourcedContext | None:
        """
        Connect to the database and fetch schema information.

        Returns SourcedContext with table structure and relationships,
        or None if the DB is unavailable or disabled.
        """
        if not self._config.enabled:
            return None
        if not self.available:
            logger.warning(
                f"DB MCP not available for {self._config.db_type}. "
                "Install DBHub: npm install -g dbhub"
            )
            return None

        try:
            return self._fetch_schema(topic_hint, max_tables)
        except MCPError as e:
            logger.warning(f"DB MCP error ({self._config.db_type}): {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected DB MCP error: {e}")
            return None

    def _fetch_schema(self, topic_hint: str, max_tables: int) -> SourcedContext:
        cmd = self._build_command()
        logger.info(f"Connecting to {self._config.db_type} via MCP...")

        with MCPStdioClient(cmd, timeout=30) as client:
            # 1. List all tables
            tables_raw = client.call_tool("list_tables", {})
            table_names = self._parse_table_list(tables_raw)

            # 2. Filter by topic if hint given
            if topic_hint:
                table_names = _filter_relevant_tables(table_names, topic_hint)
            table_names = table_names[:max_tables]

            # 3. Describe each table
            schema_parts = [
                f"## DB 스키마 ({self._config.display_name})\n"
            ]
            excerpt_tables = []
            for table in table_names:
                try:
                    desc = client.call_tool(
                        "describe_table", {"table": table}
                    )
                    schema_parts.append(f"### {table}\n```sql\n{desc}\n```")
                    excerpt_tables.append(table)
                except MCPError as e:
                    logger.debug(f"Could not describe {table}: {e}")

            content = "\n\n".join(schema_parts)
            source = DataSource(
                type="database",
                name=self._config.display_name,
                url=self._safe_url(),
                excerpt=f"테이블: {', '.join(excerpt_tables[:10])}",
                metadata={"db_type": self._config.db_type, "tables": excerpt_tables},
            )
            ctx = SourcedContext(content=content, sources=[source], context_score=20)
            logger.info(
                f"DB schema fetched: {len(excerpt_tables)} tables from {self._config.db_type}"
            )
            return ctx

    def get_procedure_source(
        self,
        proc_names: list[str],
        max_procs: int = 10,
    ) -> str:
        """
        Fetch stored procedure / function source from the DB.

        Queries DB-specific system tables:
          Oracle     → all_source WHERE name = :sp ORDER BY line
          PostgreSQL → pg_proc WHERE proname = :sp
          MySQL/MariaDB → SHOW CREATE PROCEDURE :sp
          MSSQL      → sys.sql_modules WHERE object_id = OBJECT_ID(:sp)
        """
        if not self._config.enabled or not self.available or not proc_names:
            return ""

        queries = self._sp_queries()
        if not queries:
            return ""

        parts: list[str] = []
        cmd = self._build_command()
        try:
            with MCPStdioClient(cmd, timeout=30) as client:
                for proc in proc_names[:max_procs]:
                    sql = queries.get("source", "").replace(":sp", f"'{proc}'")
                    if not sql:
                        continue
                    try:
                        result = client.call_tool("execute_query", {"query": sql})
                        if result.strip():
                            parts.append(f"### SP: {proc}\n```sql\n{result}\n```")
                    except MCPError as e:
                        logger.debug("SP source fetch failed for %s: %s", proc, e)
        except Exception as e:
            logger.warning("get_procedure_source error: %s", e)

        return "\n\n".join(parts)

    def _sp_queries(self) -> dict[str, str]:
        """DB-specific SQL to retrieve stored procedure source."""
        db = self._config.db_type
        if db == "oracle":
            return {
                "source": (
                    "SELECT text FROM all_source "
                    "WHERE name = UPPER(:sp) ORDER BY line"
                )
            }
        if db == "postgresql":
            return {
                "source": (
                    "SELECT prosrc FROM pg_proc "
                    "WHERE proname = :sp LIMIT 1"
                )
            }
        if db in ("mysql", "mariadb"):
            return {"source": "SHOW CREATE PROCEDURE :sp"}
        if db == "mssql":
            return {
                "source": (
                    "SELECT sm.definition FROM sys.sql_modules sm "
                    "JOIN sys.objects o ON sm.object_id = o.object_id "
                    "WHERE o.name = :sp"
                )
            }
        return {}

    def _build_command(self) -> list[str]:
        """Build the MCP server launch command."""
        if self._config.db_type == "oracle":
            # Oracle SQLcl: sql /nolog -mcp
            # Connection string passed via ORACLE_CONNECT env (set separately)
            return ["sql", "/nolog", "-mcp"]

        # DBHub for all other DBs
        return [
            "npx", "-y", "dbhub",
            "--db-type", self._config.db_type,
            "--connection-string", self._config.connection_string,
        ]

    def _safe_url(self) -> str:
        """Return connection URL with password redacted."""
        cs = self._config.connection_string
        # Replace password in URL (simple heuristic)
        import re
        return re.sub(r"(://[^:]+:)[^@]+(@)", r"\1****\2", cs)

    @staticmethod
    def _parse_table_list(raw: str) -> list[str]:
        """Parse DBHub list_tables output into a list of table names."""
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        # Try to extract table names (various formats)
        tables = []
        for line in lines:
            # Skip headers and separators
            if line.startswith(("-", "+", "|", "#")):
                continue
            # Take first word as table name
            word = line.split()[0].strip("|,; ") if line.split() else ""
            if word and not word.lower() in ("table", "name", "tables"):
                tables.append(word)
        return tables


def _filter_relevant_tables(tables: list[str], hint: str) -> list[str]:
    """Return tables whose names relate to the topic hint."""
    hint_lower = hint.lower()
    keywords = set(hint_lower.replace("_", " ").split())
    scored = []
    for t in tables:
        t_lower = t.lower().replace("_", " ")
        score = sum(1 for kw in keywords if kw in t_lower)
        scored.append((score, t))
    # Sort: related tables first, then alphabetical
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [t for _, t in scored]
