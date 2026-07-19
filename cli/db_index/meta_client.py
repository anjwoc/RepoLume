"""DDL CSV parser + meta MCP client for DBGraph enrichment.

Two responsibilities:
1. parse_ddl_csv()      — read existing CSV exports from a metadata portal
2. MetaMCPClient        — spawn meta MCP server to generate fresh CSV exports
"""
import csv
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default dir where the meta MCP writes CSV exports — empty = no CSV enrichment
_DEFAULT_CSV_DIR = Path()


@dataclass
class ColumnType:
    name: str
    data_type: str = ""     # e.g. "bigint", "nvarchar(200)"
    nullable: bool = True


@dataclass
class DDLTableInfo:
    table_name: str
    ddl_tbl_id: str = ""
    columns: list[ColumnType] = field(default_factory=list)
    ddl_sql: str = ""
    server_name: str = ""
    db_name: str = ""


# ── DDL SQL parser ────────────────────────────────────────────────────────────

_RE_COL_DEF = re.compile(
    r"^\s{4}(\w+)\s+([\w]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)"
    r"(\s+NOT NULL)?",
    re.IGNORECASE,
)
_RE_CREATE = re.compile(
    r"CREATE\s+TABLE\s+\S+\s*\((.+?)\)(?:\s*WITH|\s*ON|\s*;|$)",
    re.DOTALL | re.IGNORECASE,
)


def parse_ddl_sql(ddl_sql: str) -> list[ColumnType]:
    """Extract column name + type from a MSSQL CREATE TABLE statement."""
    m = _RE_CREATE.search(ddl_sql)
    if not m:
        return []
    body = m.group(1)
    columns: list[ColumnType] = []
    for line in body.splitlines():
        cm = _RE_COL_DEF.match(line)
        if cm:
            col_name = cm.group(1).upper()
            data_type = cm.group(2).strip()
            nullable = cm.group(3) is None  # NOT NULL present → nullable=False
            # Skip SQL keywords that can appear as first token
            if col_name.upper() in ("CONSTRAINT", "PRIMARY", "UNIQUE", "INDEX", "KEY"):
                continue
            columns.append(ColumnType(name=col_name, data_type=data_type, nullable=nullable))
    return columns


# ── CSV parser ────────────────────────────────────────────────────────────────

def parse_ddl_csv(csv_path: Path) -> dict[str, DDLTableInfo]:
    """Parse a DDL CSV export from the meta portal.

    CSV columns: 테이블ID, 테이블명, 논리명, DDL_SQL, 컬럼_목록, DB_SCH_ID, …
    Returns {table_name: DDLTableInfo}.
    """
    result: dict[str, DDLTableInfo] = {}
    try:
        with open(csv_path, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                table_name = (row.get("테이블명") or "").strip().upper()
                if not table_name:
                    continue
                ddl_sql = row.get("DDL_SQL") or ""
                columns = parse_ddl_sql(ddl_sql)

                # Extract server / db from DDL comment header
                server = _extract_comment_field(ddl_sql, "HOST NAME")
                db = _extract_comment_field(ddl_sql, "DBMS NAME")

                result[table_name] = DDLTableInfo(
                    table_name=table_name,
                    ddl_tbl_id=row.get("테이블ID", ""),
                    columns=columns,
                    ddl_sql=ddl_sql,
                    server_name=server.upper(),
                    db_name=db,
                )
    except Exception as e:
        logger.warning("DDL CSV 파싱 실패 %s: %s", csv_path, e)
    return result


def parse_ddl_csv_dir(csv_dir: Path | str) -> dict[str, DDLTableInfo]:
    """Parse all DDL_*.csv files in csv_dir. Later files overwrite earlier on same table name."""
    csv_dir = Path(csv_dir)
    merged: dict[str, DDLTableInfo] = {}
    for csv_path in sorted(csv_dir.glob("DDL_*.csv")):
        merged.update(parse_ddl_csv(csv_path))
    logger.info("DDL CSV 로드: %d 테이블 (dir=%s)", len(merged), csv_dir)
    return merged


def _extract_comment_field(ddl_sql: str, field_name: str) -> str:
    """Extract value from DDL comment lines like '-- HOST NAME   : MAINDB2'."""
    pattern = re.compile(rf"--\s*{re.escape(field_name)}\s*:\s*(\S+)", re.IGNORECASE)
    m = pattern.search(ddl_sql)
    return m.group(1) if m else ""


# ── Meta MCP client ───────────────────────────────────────────────────────────

class MetaMCPClient:
    """Call a custom MCP server via MCPStdioClient to generate DDL CSV exports.

    Custom usage: pass mcp_cmd pointing to a user-provided metadata MCP server.
    Generic usage: subclass or skip — use pre-existing CSV files via csv_dir instead.
    """

    def __init__(
        self,
        output_dir: Path | str = ".",
        mcp_cmd: list[str] | None = None,
        timeout: int = 120,
    ):
        self._output_dir = Path(output_dir)
        self._mcp_cmd = mcp_cmd or []
        self._timeout = timeout

    def generate_ddl_csv(self, db_conn_name: str, db_sch_name: str = "dbo") -> Optional[Path]:
        """Call save_ddl_with_columns_to_file → returns path to generated CSV, or None on failure."""
        if not self._mcp_cmd:
            logger.warning("MetaMCPClient: mcp_cmd not configured, skipping DDL generation")
            return None
        try:
            from cli.mcp.base_client import MCPStdioClient
        except ImportError:
            logger.error("MCPStdioClient 없음")
            return None

        try:
            with MCPStdioClient(self._mcp_cmd, timeout=self._timeout) as client:
                result = client.call_tool("save_ddl_with_columns_to_file", {
                    "db_conn_name": db_conn_name,
                    "db_sch_name": db_sch_name,
                })
            if isinstance(result, dict) and result.get("success"):
                file_path = result.get("file_path")
                if file_path:
                    return Path(file_path)
            logger.warning("DDL CSV 생성 실패: db=%s result=%s", db_conn_name, result)
        except Exception as e:
            logger.error("MetaMCP 호출 오류 (db=%s): %s", db_conn_name, e)
        return None

    def list_servers(self) -> dict[str, int]:
        """Return {server_name: server_id} from meta portal."""
        if not self._mcp_cmd:
            return {}
        try:
            from cli.mcp.base_client import MCPStdioClient
            with MCPStdioClient(self._mcp_cmd, timeout=self._timeout) as client:
                result = client.call_tool("list_servers", {})
            if isinstance(result, dict) and result.get("success"):
                return result.get("servers", {})
        except Exception as e:
            logger.error("list_servers 실패: %s", e)
        return {}
