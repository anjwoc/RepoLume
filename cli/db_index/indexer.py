"""DBGraph indexer: JPA scan + DDL CSV enrichment → SQLite.

Usage:
    python -m cli.db_index.indexer sync /path/to/affiliate [--project myproject]
    python -m cli.db_index.indexer query "settle" [--project myproject]
"""
import logging
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from cli.db_index.scanner import TableInfo, scan_jpa_entities
from cli.db_index.meta_client import DDLTableInfo, parse_ddl_csv_dir

logger = logging.getLogger(__name__)

_INDEX_ROOT = Path.home() / ".localwiki" / "db-index"
_MAX_AGE_HOURS = 24


# ── SQLite schema ─────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS db_tables (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fqn         TEXT UNIQUE NOT NULL,   -- SERVER.SCHEMA.TABLE or TABLE
    table_name  TEXT NOT NULL,
    schema_name TEXT DEFAULT '',
    server_name TEXT DEFAULT '',
    db_type     TEXT DEFAULT '',
    ddl_tbl_id  TEXT DEFAULT '',
    ddl_sql     TEXT DEFAULT '',
    source_file TEXT DEFAULT '',
    indexed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_columns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id    INTEGER NOT NULL REFERENCES db_tables(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    data_type   TEXT DEFAULT '',
    nullable    INTEGER DEFAULT 1,
    is_pk       INTEGER DEFAULT 0,
    is_fk       INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_col_table ON db_columns(table_id);
CREATE INDEX IF NOT EXISTS idx_tbl_name  ON db_tables(table_name);

CREATE VIRTUAL TABLE IF NOT EXISTS tables_fts USING fts5(
    fqn, table_name, server_name, content='db_tables', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS tbl_ai AFTER INSERT ON db_tables BEGIN
    INSERT INTO tables_fts(rowid, fqn, table_name, server_name)
    VALUES (new.id, new.fqn, new.table_name, new.server_name);
END;
"""


# ── Path helpers ──────────────────────────────────────────────────────────────

def _db_path(project_id: str) -> Path:
    p = _INDEX_ROOT / project_id
    p.mkdir(parents=True, exist_ok=True)
    return p / "dbgraph.db"


# ── Build index ───────────────────────────────────────────────────────────────

def build_index(
    source_dir: str,
    project_id: str = "default",
    csv_dir: Path | str | None = None,
    entity_pattern: str = "*JpaEntity.java",
) -> dict:
    """Scan entity files + enrich from DDL CSVs → write SQLite.

    Returns summary dict with counts.
    """
    t0 = time.monotonic()
    _csv_dir: Path | None = Path(csv_dir).expanduser() if csv_dir else None

    # Phase 1: entity scan (free)
    logger.info("[dbgraph] Phase 1: 엔티티 스캔 중 (%s, pattern=%s)", source_dir, entity_pattern)
    jpa_tables: dict[str, TableInfo] = scan_jpa_entities(source_dir, entity_pattern)
    logger.info("[dbgraph] 스캔 완료: %d FQN", len(jpa_tables))

    # Phase 2: DDL CSV 로드 (free, local files)
    ddl_map: dict[str, DDLTableInfo] = {}
    if _csv_dir and _csv_dir.exists():
        logger.info("[dbgraph] Phase 2: DDL CSV 로드 중 (%s)", _csv_dir)
        ddl_map = parse_ddl_csv_dir(_csv_dir)

    # Phase 3: SQLite 저장
    db_file = _db_path(project_id)
    logger.info("[dbgraph] Phase 3: SQLite 저장 (%s)", db_file)
    now = datetime.now(timezone.utc).isoformat()

    with sqlite3.connect(db_file) as conn:
        conn.executescript(_SCHEMA_SQL)
        conn.execute("DELETE FROM db_columns")
        conn.execute("DELETE FROM db_tables")
        conn.execute("DELETE FROM tables_fts")
        conn.execute("DELETE FROM meta")

        enriched = 0
        for fqn, info in jpa_tables.items():
            ddl = ddl_map.get(info.table_name)

            # Insert table row
            cur = conn.execute(
                """INSERT INTO db_tables
                   (fqn, table_name, schema_name, server_name, db_type,
                    ddl_tbl_id, ddl_sql, source_file, indexed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (fqn, info.table_name, info.schema_name, info.server_name,
                 info.db_type,
                 ddl.ddl_tbl_id if ddl else "",
                 ddl.ddl_sql if ddl else "",
                 info.source_file, now),
            )
            table_id = cur.lastrowid
            if ddl:
                enriched += 1

            # Build column list: prefer DDL types, fall back to JPA names only
            if ddl and ddl.columns:
                # Map JPA pk/fk flags by name
                jpa_col_flags = {c.name.upper(): c for c in info.columns}
                for dc in ddl.columns:
                    jpa_c = jpa_col_flags.get(dc.name.upper())
                    conn.execute(
                        "INSERT INTO db_columns (table_id, name, data_type, nullable, is_pk, is_fk) VALUES (?,?,?,?,?,?)",
                        (table_id, dc.name, dc.data_type, int(dc.nullable),
                         int(jpa_c.is_pk if jpa_c else False),
                         int(jpa_c.is_fk if jpa_c else False)),
                    )
            else:
                for jc in info.columns:
                    conn.execute(
                        "INSERT INTO db_columns (table_id, name, data_type, nullable, is_pk, is_fk) VALUES (?,?,?,?,?,?)",
                        (table_id, jc.name, "", 1, int(jc.is_pk), int(jc.is_fk)),
                    )

        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [
                ("indexed_at", now),
                ("source_dir", str(source_dir)),
                ("entity_pattern", entity_pattern),
                ("jpa_count", str(len(jpa_tables))),
                ("csv_count", str(len(ddl_map))),
                ("enriched_count", str(enriched)),
            ],
        )

    elapsed = time.monotonic() - t0
    summary = {
        "db_file": str(db_file),
        "jpa_tables": len(jpa_tables),
        "ddl_tables": len(ddl_map),
        "enriched": enriched,
        "elapsed_s": round(elapsed, 2),
    }
    logger.info("[dbgraph] 완료: %s", summary)
    return summary


# ── Load + query ──────────────────────────────────────────────────────────────

def is_fresh(project_id: str = "default", max_age_hours: int = _MAX_AGE_HOURS) -> bool:
    db_file = _db_path(project_id)
    if not db_file.exists():
        return False
    try:
        with sqlite3.connect(db_file) as conn:
            row = conn.execute("SELECT value FROM meta WHERE key='indexed_at'").fetchone()
        if not row:
            return False
        indexed_at = datetime.fromisoformat(row[0])
        age_hours = (datetime.now(timezone.utc) - indexed_at).total_seconds() / 3600
        return age_hours < max_age_hours
    except Exception:
        return False


def query_index(keywords: list[str], project_id: str = "default", limit: int = 30) -> list[dict]:
    """FTS5 search by keywords. Returns list of {fqn, table_name, server, columns}."""
    db_file = _db_path(project_id)
    if not db_file.exists():
        return []
    try:
        with sqlite3.connect(db_file) as conn:
            conn.row_factory = sqlite3.Row
            query_str = " OR ".join(keywords)
            rows = conn.execute(
                """SELECT t.id, t.fqn, t.table_name, t.schema_name, t.server_name, t.db_type
                   FROM tables_fts f
                   JOIN db_tables t ON t.id = f.rowid
                   WHERE tables_fts MATCH ?
                   LIMIT ?""",
                (query_str, limit),
            ).fetchall()
            result = []
            for r in rows:
                cols = conn.execute(
                    "SELECT name, data_type, is_pk, is_fk FROM db_columns WHERE table_id=?",
                    (r["id"],),
                ).fetchall()
                result.append({
                    "fqn": r["fqn"],
                    "table_name": r["table_name"],
                    "server_name": r["server_name"],
                    "db_type": r["db_type"],
                    "columns": [
                        {"name": c["name"], "type": c["data_type"],
                         "is_pk": bool(c["is_pk"]), "is_fk": bool(c["is_fk"])}
                        for c in cols
                    ],
                })
            return result
    except Exception as e:
        logger.error("query_index 오류: %s", e)
        return []


def build_schema_text(project_id: str = "default", max_tables: int = 200) -> str:
    """Build '### TABLE_NAME\n<cols...>' text for /api/mcp/init DB schema field.

    Same heading format as DatabaseMCPClient.get_schema_context() output.
    """
    db_file = _db_path(project_id)
    if not db_file.exists():
        return ""
    try:
        parts: list[str] = []
        with sqlite3.connect(db_file) as conn:
            conn.row_factory = sqlite3.Row
            tables = conn.execute(
                "SELECT id, fqn, table_name, server_name, schema_name, ddl_sql FROM db_tables LIMIT ?",
                (max_tables,),
            ).fetchall()
            for t in tables:
                heading = f"### {t['fqn']}"
                if t["ddl_sql"]:
                    # Use DDL SQL directly (already has CREATE TABLE)
                    body = t["ddl_sql"][:2000]
                else:
                    cols = conn.execute(
                        "SELECT name, data_type, is_pk FROM db_columns WHERE table_id=?",
                        (t["id"],),
                    ).fetchall()
                    col_lines = [
                        f"  {c['name']} {c['data_type']}{' (PK)' if c['is_pk'] else ''}"
                        for c in cols
                    ]
                    body = "\n".join(col_lines)
                parts.append(f"{heading}\n{body}")
        return "\n\n".join(parts)
    except Exception as e:
        logger.error("build_schema_text 오류: %s", e)
        return ""


def get_table_context(table_names: list[str], project_id: str = "default") -> str:
    """Build '### 테이블: NAME\\n```sql\\n<DDL>\\n```' context for /api/mcp/collect.

    Matches the format emitted by collect_cross_check_context() DB section.
    """
    if not table_names:
        return ""
    db_file = _db_path(project_id)
    if not db_file.exists():
        return ""
    try:
        parts: list[str] = []
        with sqlite3.connect(db_file) as conn:
            conn.row_factory = sqlite3.Row
            for name in table_names[:20]:
                row = conn.execute(
                    "SELECT id, fqn, ddl_sql FROM db_tables WHERE table_name = ? OR fqn = ? LIMIT 1",
                    (name.upper(), name.upper()),
                ).fetchone()
                if not row:
                    continue
                if row["ddl_sql"]:
                    body = f"```sql\n{row['ddl_sql'][:1500]}\n```"
                else:
                    cols = conn.execute(
                        "SELECT name, data_type, is_pk, is_fk FROM db_columns WHERE table_id=?",
                        (row["id"],),
                    ).fetchall()
                    col_lines = [
                        f"  {c['name']} {c['data_type']}"
                        + (" PK" if c["is_pk"] else "")
                        + (" FK" if c["is_fk"] else "")
                        for c in cols
                    ]
                    body = "```sql\n-- 컬럼 목록\n" + "\n".join(col_lines) + "\n```"
                parts.append(f"### 테이블: {row['fqn']}\n{body}")
        return "\n\n".join(parts)
    except Exception as e:
        logger.error("get_table_context 오류: %s", e)
        return ""


def get_status(project_id: str = "default") -> dict:
    db_file = _db_path(project_id)
    if not db_file.exists():
        return {"exists": False}
    try:
        with sqlite3.connect(db_file) as conn:
            meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
            table_count = conn.execute("SELECT COUNT(*) FROM db_tables").fetchone()[0]
        return {
            "exists": True,
            "db_file": str(db_file),
            "indexed_at": meta.get("indexed_at"),
            "jpa_tables": int(meta.get("jpa_count", 0)),
            "ddl_tables": int(meta.get("csv_count", 0)),
            "enriched": int(meta.get("enriched_count", 0)),
            "total_in_db": table_count,
            "fresh": is_fresh(project_id),
        }
    except Exception as e:
        return {"exists": True, "error": str(e)}


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"

    if cmd == "sync":
        src = sys.argv[2] if len(sys.argv) > 2 else "."
        project = sys.argv[3] if len(sys.argv) > 3 else "default"
        result = build_index(src, project_id=project)
        print(f"✅ 인덱싱 완료: {result}")

    elif cmd == "query":
        keywords = sys.argv[2].split() if len(sys.argv) > 2 else ["settle"]
        project = sys.argv[3] if len(sys.argv) > 3 else "default"
        rows = query_index(keywords, project_id=project)
        print(f"결과: {len(rows)}개")
        for r in rows[:5]:
            pks = [c["name"] for c in r["columns"] if c["is_pk"]]
            print(f"  {r['fqn']} — pk={pks} cols={len(r['columns'])}")

    elif cmd == "status":
        project = sys.argv[2] if len(sys.argv) > 2 else "default"
        print(get_status(project))

    else:
        print("Usage: python -m cli.db_index.indexer sync <dir> [project]")
        print("       python -m cli.db_index.indexer query <keywords> [project]")
        print("       python -m cli.db_index.indexer status [project]")
