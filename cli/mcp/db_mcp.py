"""
Database MCP Client — DBHub (PostgreSQL/MySQL/MSSQL/MariaDB) + mcp-alchemy (Oracle).

DBHub (https://github.com/bytebase/dbhub) is a zero-dependency MCP server
supporting multiple databases with a single install.

Oracle uses mcp-alchemy: `uvx --with oracledb mcp-alchemy` with DB_URL env var.
  DB_URL format: oracle+oracledb://USER:PASS@HOST:PORT/?service_name=SVC

mcp-alchemy tool names differ from DBHub:
  all_table_names      (DBHub: list_tables)
  schema_definitions   (DBHub: describe_table)
  filter_table_names   (DBHub: n/a)
  execute_query        (same)
"""
from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass

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


DB_TYPE_PATTERNS: dict[str, list[str]] = {
    "oracle":     ["oracle", "cx_oracle", "oracledb", "jdbc:oracle"],
    "mysql":      ["mysql", "mysql2", "jdbc:mysql", "pymysql"],
    "mssql":      ["sqlserver", "mssql", "pymssql", "jdbc:sqlserver", "pyodbc"],
    "mariadb":    ["mariadb"],
    "postgresql": ["postgresql", "psycopg2", "jdbc:postgresql"],
    "mongodb":    ["mongodb", "pymongo", "mongoose"],
}


class DatabaseMCPClient:
    """
    Fetches DB schema context via DBHub (PostgreSQL/MySQL/MSSQL/MariaDB)
    or mcp-alchemy (Oracle) MCP server.
    """

    def __init__(self, config: DBConfig):
        self._config = config

    @staticmethod
    def detect_db_types(code_snippets: list[str]) -> set[str]:
        """Infer which DB types are referenced in the given code snippets."""
        detected: set[str] = set()
        combined = "\n".join(code_snippets).lower()
        for db_type, patterns in DB_TYPE_PATTERNS.items():
            if any(p in combined for p in patterns):
                detected.add(db_type)
        return detected

    @property
    def available(self) -> bool:
        if self._config.db_type == "oracle":
            return shutil.which("sql") is not None or shutil.which("uvx") is not None
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
            if self._config.db_type == "oracle":
                logger.warning("Oracle MCP unavailable: uvx not found. Install: pip install uvx")
            else:
                logger.warning(f"DB MCP not available for {self._config.db_type}. Install: npm install -g dbhub")
            return None

        try:
            return self._fetch_schema(topic_hint, max_tables)
        except MCPError as e:
            logger.warning(f"DB MCP error ({self._config.db_type}): {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected DB MCP error: {e}")
            return None

    def _get_env(self) -> dict | None:
        """Return extra env vars for this DB's MCP server subprocess, or None."""
        if self._config.db_type == "oracle":
            if self._build_command()[0] == "sql":
                return {"ORACLE_CONNECT": self._config.connection_string}
            return {"DB_URL": self._config.connection_string}
        return None

    def _fetch_schema(self, topic_hint: str, max_tables: int) -> SourcedContext:
        cmd = self._build_command()
        env = self._get_env()
        logger.info(f"Connecting to {self._config.db_type} via MCP...")

        with MCPStdioClient(cmd, timeout=30, env=env) as client:
            if self._config.db_type == "oracle" and cmd[0] == "uvx":
                return self._fetch_schema_oracle(client, topic_hint, max_tables)

            # ── DBHub path (PostgreSQL / MySQL / MSSQL / MariaDB) ────────────
            tables_raw = client.call_tool("list_tables", {})
            table_names = self._parse_table_list(tables_raw)

            # MSSQL: DBHub list_tables may return empty for service accounts —
            # fall back to INFORMATION_SCHEMA which requires no ownership
            if not table_names and self._config.db_type == "mssql":
                q = (
                    "SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS TABLE_NAME "
                    "FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
                )
                try:
                    raw = client.call_tool("execute_query", {"query": q})
                    rows = self._parse_execute_query_rows(raw)
                    table_names = [r.get("TABLE_NAME", "").strip() for r in rows if r.get("TABLE_NAME")]
                    if table_names:
                        logger.info("MSSQL: list_tables empty, INFORMATION_SCHEMA fallback found %d tables", len(table_names))
                except MCPError as e:
                    logger.debug("MSSQL INFORMATION_SCHEMA fallback failed: %s", e)

            if topic_hint:
                table_names = _filter_relevant_tables(table_names, topic_hint)
            table_names = table_names[:max_tables]

            schema_parts = [f"## DB 스키마 ({self._config.display_name})\n"]
            excerpt_tables = []
            for table in table_names:
                try:
                    desc = client.call_tool("describe_table", {"table": table})
                    schema_parts.append(f"### {table}\n```sql\n{desc}\n```")
                    excerpt_tables.append(table)
                except MCPError as e:
                    logger.debug(f"Could not describe {table}: {e}")

            return self._build_context(schema_parts, excerpt_tables)

    def _fetch_schema_oracle(
        self,
        client: "MCPStdioClient",
        topic_hint: str,
        max_tables: int,
    ) -> SourcedContext:
        """Schema fetch for Oracle via mcp-alchemy.

        SQLAlchemy-based tools (all_table_names, schema_definitions) only see
        tables owned by the current user.  For service accounts (S_*) that
        read from a separate data-owner schema (O_*) those tools return nothing.
        We fall back to execute_query throughout.
        """
        # 1. Try all_table_names (works when the DB user owns the tables)
        tables_raw = client.call_tool("all_table_names", {})
        table_names = self._parse_table_list(tables_raw)
        use_native_ddl = bool(table_names)
        data_owner: str | None = None

        # 2. Fallback: service account pattern S_USER → O_USER data owner
        if not table_names:
            data_owner, table_names = self._oracle_list_tables_via_query(client)
            if table_names:
                logger.info(
                    "Oracle all_table_names empty — fallback: %d tables (owner=%s)",
                    len(table_names), data_owner,
                )

        # 3. Topic-based filtering
        if topic_hint and table_names:
            if use_native_ddl:
                # filter_table_names only accepts q (topic), not a table list
                try:
                    filtered_raw = client.call_tool("filter_table_names", {"q": topic_hint})
                    filtered = self._parse_table_list(filtered_raw)
                    if filtered:
                        table_names = filtered
                    else:
                        table_names = _filter_relevant_tables(table_names, topic_hint)
                except MCPError:
                    table_names = _filter_relevant_tables(table_names, topic_hint)
            else:
                table_names = _filter_relevant_tables(table_names, topic_hint)

        table_names = table_names[:max_tables]
        schema_parts = [f"## DB 스키마 ({self._config.display_name})\n"]
        excerpt_tables: list[str] = []

        if table_names:
            if use_native_ddl:
                # 4a. schema_definitions (owned tables only)
                try:
                    import re as _re
                    ddl_raw = client.call_tool(
                        "schema_definitions", {"table_names": table_names}
                    )
                    blocks = _re.split(r"\n(?=###\s)", ddl_raw.strip())
                    for block in blocks:
                        m = _re.match(r"###\s+(\S+)", block)
                        if m:
                            tname = m.group(1)
                            excerpt_tables.append(tname)
                            schema_parts.append(
                                f"### {tname}\n```sql\n{block[len(m.group(0)):].strip()}\n```"
                            )
                        elif block.strip():
                            schema_parts.append(block.strip())
                    if not excerpt_tables:
                        schema_parts.append(f"```sql\n{ddl_raw}\n```")
                        excerpt_tables = table_names
                except MCPError as e:
                    logger.warning("Oracle schema_definitions failed: %s", e)

            if not excerpt_tables:
                # 4b. Fallback: build DDL from all_tab_columns via execute_query
                excerpt_tables = self._oracle_ddl_via_columns(
                    client, table_names, data_owner, schema_parts
                )

        return self._build_context(schema_parts, excerpt_tables)

    def _oracle_list_tables_via_query(
        self, client: "MCPStdioClient"
    ) -> tuple[str | None, list[str]]:
        """Return (data_owner, table_names) via execute_query.

        Covers the S_USER → O_USER service-account pattern where
        all_table_names returns nothing because the user owns no tables.
        """
        sql = (
            "SELECT table_name, owner FROM ("
            "  SELECT table_name, USER AS owner FROM user_tables"
            "  UNION ALL"
            "  SELECT table_name, owner FROM all_tables"
            "  WHERE owner = UPPER(REPLACE(USER, 'S_', 'O_'))"
            ") WHERE table_name NOT LIKE 'BIN$%'"
            " ORDER BY table_name FETCH FIRST 100 ROWS ONLY"
        )
        try:
            raw = client.call_tool("execute_query", {"query": sql})
            rows = self._parse_execute_query_rows(raw)
            table_names = [r["table_name"].strip() for r in rows if r.get("table_name")]
            # Prefer the data-owner schema (not starting with S_)
            data_owner = None
            for r in rows:
                o = (r.get("owner") or "").strip()
                if o and not o.upper().startswith("S_"):
                    data_owner = o
                    break
            return data_owner, table_names
        except MCPError as e:
            logger.debug("Oracle table list query failed: %s", e)
            return None, []

    def _oracle_ddl_via_columns(
        self,
        client: "MCPStdioClient",
        table_names: list[str],
        owner: str | None,
        schema_parts: list[str],
    ) -> list[str]:
        """Build pseudo-DDL from all_tab_columns for non-owned Oracle tables.

        mcp-alchemy's execute_query truncates at 26 rows, so we query each
        table individually to avoid cross-table truncation.
        """
        owner_filter = f"AND owner = '{owner}'" if owner else ""
        excerpt_tables: list[str] = []

        for tname in table_names:
            sql = (
                f"SELECT column_name, data_type, data_length, "
                f"data_precision, data_scale, nullable "
                f"FROM all_tab_columns "
                f"WHERE table_name = '{tname}' {owner_filter} "
                f"ORDER BY column_id"
            )
            try:
                raw = client.call_tool("execute_query", {"query": sql})
                rows = self._parse_execute_query_rows(raw)
            except MCPError as e:
                logger.debug("Oracle column query failed for %s: %s", tname, e)
                continue

            if not rows:
                continue

            col_defs = []
            for col in rows:
                col_name = (col.get("column_name") or "").strip()
                dtype = (col.get("data_type") or "").strip()
                length = (col.get("data_length") or "").strip()
                prec = (col.get("data_precision") or "").strip()
                scale = (col.get("data_scale") or "").strip()
                nullable = "" if (col.get("nullable") or "Y") == "Y" else " NOT NULL"
                if dtype in ("NUMBER", "FLOAT") and prec and prec not in ("None", "NULL", ""):
                    type_str = (
                        f"NUMBER({prec},{scale})"
                        if scale and scale not in ("None", "NULL", "0", "")
                        else f"NUMBER({prec})"
                    )
                elif dtype in ("VARCHAR2", "CHAR", "NVARCHAR2", "NCHAR") and length:
                    type_str = f"{dtype}({length})"
                else:
                    type_str = dtype
                if col_name:
                    col_defs.append(f"  {col_name} {type_str}{nullable}")

            if col_defs:
                ddl = "CREATE TABLE " + tname + " (\n" + ",\n".join(col_defs) + "\n);"
                schema_parts.append(f"### {tname}\n```sql\n{ddl}\n```")
                excerpt_tables.append(tname)

        return excerpt_tables

    @staticmethod
    def _parse_execute_query_rows(raw: str) -> list[dict]:
        """Parse mcp-alchemy execute_query '1. row\\ncol: val' format into list of dicts."""
        rows: list[dict] = []
        current: dict = {}
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                if current:
                    rows.append(current)
                    current = {}
                continue
            parts = line.split()
            # "1. row", "2. row" — row separator
            if len(parts) == 2 and parts[1] == "row" and parts[0].rstrip(".").isdigit():
                if current:
                    rows.append(current)
                current = {}
                continue
            if line.startswith("Result:"):
                if current:
                    rows.append(current)
                current = {}
                continue
            if ": " in line:
                key, _, val = line.partition(": ")
                current[key.strip()] = val.strip()
        if current:
            rows.append(current)
        return rows

    def _build_context(self, schema_parts: list[str], excerpt_tables: list[str]) -> SourcedContext:
        content = "\n\n".join(schema_parts)
        source = DataSource(
            type="database",
            name=self._config.display_name,
            url=self._safe_url(),
            excerpt=f"테이블: {', '.join(excerpt_tables[:10])}",
            metadata={"db_type": self._config.db_type, "tables": excerpt_tables},
        )
        ctx = SourcedContext(content=content, sources=[source], context_score=20)
        logger.info("DB schema fetched: %d tables from %s", len(excerpt_tables), self._config.db_type)
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
        env = self._get_env()
        try:
            with MCPStdioClient(cmd, timeout=30, env=env) as client:
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
            if not self._config.connection_string or shutil.which("sql") is not None:
                return ["sql", "/nolog", "-mcp"]
            return ["uvx", "--with", "oracledb", "mcp-alchemy"]

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
        """Parse table list from DBHub or mcp-alchemy output."""
        import json as _json
        # mcp-alchemy may return a JSON array
        stripped = raw.strip()
        if stripped.startswith("["):
            try:
                parsed = _json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(t) for t in parsed if t]
            except (_json.JSONDecodeError, ValueError):
                pass
        # DBHub / line-based fallback
        lines = [line.strip() for line in stripped.splitlines() if line.strip()]
        tables = []
        for line in lines:
            if line.startswith(("-", "+", "|", "#")):
                continue
            word = line.split()[0].strip("|,; ") if line.split() else ""
            if word and word.lower() not in ("table", "name", "tables"):
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
