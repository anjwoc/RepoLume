"""JPA entity scanner: extract table/column info from *JpaEntity.java files."""
import re
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class ColumnInfo:
    name: str
    is_pk: bool = False
    is_fk: bool = False


@dataclass
class TableInfo:
    table_name: str           # bare table name (last segment of FQN)
    schema_name: str = ""     # e.g. "DBO"
    server_name: str = ""     # e.g. "STARDB"
    columns: list[ColumnInfo] = field(default_factory=list)
    source_file: str = ""
    db_type: str = ""


_RE_TABLE = re.compile(r'@Table\s*\(\s*name\s*=\s*"([^"]+)"')
_RE_COLUMN = re.compile(r'@Column\s*\([^)]*name\s*=\s*"([^"]+)"')
_RE_JOIN_COLUMN = re.compile(r'@JoinColumn\s*\([^)]*name\s*=\s*"([^"]+)"')
_RE_MAPPED_SUPERCLASS = re.compile(r'@MappedSuperclass\b')
_RE_ID = re.compile(r'@Id\b')


def scan_jpa_entities(source_dir: str, entity_pattern: str = "*JpaEntity.java") -> dict[str, TableInfo]:
    """Scan entity files under source_dir. Returns {fqn: TableInfo}.

    Key is SERVER.SCHEMA.TABLE when server/schema known, otherwise bare table name.
    Same-projection duplicates (same FQN, multiple entity classes) → last file wins.
    """
    result: dict[str, TableInfo] = {}
    for java_file in Path(source_dir).rglob(entity_pattern):
        try:
            info = _parse_entity_file(java_file)
        except Exception:
            continue
        if info:
            fqn = ".".join(filter(None, [info.server_name, info.schema_name, info.table_name]))
            result[fqn] = info
    return result


def _parse_fqn(raw: str) -> tuple[str, str, str]:
    """Parse 'SERVER.SCHEMA.TABLE' or 'SCHEMA.TABLE' or 'TABLE' → (server, schema, table)."""
    # Handle comma-separated (e.g. "TABLE1, TABLE2") — take first
    raw = raw.split(",")[0].strip()
    parts = [p.strip() for p in raw.split(".")]
    if len(parts) >= 3:
        return parts[-3], parts[-2], parts[-1]
    if len(parts) == 2:
        return "", parts[0], parts[1]
    return "", "", parts[0]


def _parse_entity_file(java_file: Path) -> TableInfo | None:
    text = java_file.read_text(encoding="utf-8", errors="replace")

    if _RE_MAPPED_SUPERCLASS.search(text):
        return None

    table_match = _RE_TABLE.search(text)
    if not table_match:
        return None

    server, schema, table_name = _parse_fqn(table_match.group(1))
    if not table_name:
        return None

    columns: list[ColumnInfo] = []
    next_is_pk = False

    for line in text.splitlines():
        s = line.strip()

        if _RE_ID.search(s):
            next_is_pk = True
            continue

        m = _RE_COLUMN.search(s)
        if m:
            columns.append(ColumnInfo(name=m.group(1), is_pk=next_is_pk))
            next_is_pk = False
            continue

        m = _RE_JOIN_COLUMN.search(s)
        if m:
            columns.append(ColumnInfo(name=m.group(1), is_fk=True))
            next_is_pk = False
            continue

        # Non-annotation, non-blank line resets the @Id flag
        if s and not s.startswith(("@", "//", "*")):
            next_is_pk = False

    return TableInfo(
        table_name=table_name,
        schema_name=schema,
        server_name=server,
        columns=columns,
        source_file=str(java_file),
    )


if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    tables = scan_jpa_entities(src)
    servers = {info.server_name for info in tables.values() if info.server_name}
    print(f"tables={len(tables)}, servers={servers}")
    for name, info in list(tables.items())[:5]:
        pks = [c.name for c in info.columns if c.is_pk]
        fqn = ".".join(filter(None, [info.server_name, info.schema_name, name]))
        print(f"  {fqn}: {len(info.columns)} cols, pk={pks}")
