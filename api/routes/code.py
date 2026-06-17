"""Code entity extraction — CodeGraph-first, regex fallback.

Phase 2.5 of the wiki generation pipeline:
  - If graphify-out/graph.json exists for the project, query it via `graphify query`
    (sub-millisecond, no token waste from repeated grep/read cycles).
  - Otherwise fall back to regex scanning of source files.
  - Emits entity.extracted event via the task stream.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from api.events import EventType, PhaseType
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Data model ───────────────────────────────────────────────────────────────

@dataclass
class CodeEntities:
    db_tables: list[str] = field(default_factory=list)
    stored_procs: list[str] = field(default_factory=list)
    kafka_topics: list[str] = field(default_factory=list)
    api_endpoints: list[str] = field(default_factory=list)
    service_names: list[str] = field(default_factory=list)
    env_references: list[str] = field(default_factory=list)
    source: str = "regex"  # "codegraph" | "regex"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def counts(self) -> dict[str, int]:
        return {
            "tables": len(self.db_tables),
            "procs": len(self.stored_procs),
            "topics": len(self.kafka_topics),
            "endpoints": len(self.api_endpoints),
            "services": len(self.service_names),
        }


class ExtractRequest(BaseModel):
    project_path: str
    file_paths: list[str] = []
    stream_id: Optional[str] = None


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/api/code/extract-entities")
async def extract_entities(req: ExtractRequest) -> dict[str, Any]:
    stream_id = req.stream_id
    project_path = req.project_path.rstrip("/")

    await emit_task_event(stream_id, EventType.PHASE_STARTED,
                          phase=PhaseType.EXTRACT,
                          message="🔬 코드 엔티티 추출 시작...")

    try:
        # Strategy 1: CodeGraph index
        graph_json = Path(project_path) / "graphify-out" / "graph.json"
        if graph_json.exists():
            entities = await _extract_via_codegraph(project_path, stream_id)
        else:
            # Auto-index in background for next run, proceed with regex now
            asyncio.create_task(_background_index(project_path))
            entities = await _extract_via_regex(project_path, req.file_paths, stream_id)
    except Exception as e:
        logger.error("Entity extraction error: %s", e)
        entities = CodeEntities()

    await emit_task_event(
        stream_id, EventType.ENTITY_EXTRACTED,
        phase=PhaseType.EXTRACT,
        message=f"✅ 엔티티 추출 완료 (source={entities.source}) — "
                f"테이블 {len(entities.db_tables)}개, "
                f"SP {len(entities.stored_procs)}개, "
                f"토픽 {len(entities.kafka_topics)}개",
        data={**entities.counts(), "source": entities.source},
    )
    await emit_task_event(stream_id, EventType.PHASE_COMPLETED,
                          phase=PhaseType.EXTRACT,
                          message="🔬 엔티티 추출 완료")

    return entities.to_dict()


# ─── CodeGraph strategy ───────────────────────────────────────────────────────

async def _extract_via_codegraph(project_path: str, stream_id: Optional[str]) -> CodeEntities:
    """Query the graphify index (≤6 calls, no repeated grep)."""
    await emit_task_event(stream_id, EventType.AGENT_REQUEST,
                          phase=PhaseType.EXTRACT,
                          message="🔍 CodeGraph 인덱스 쿼리 중...")

    queries = {
        "db_tables":     "SQL table name SELECT FROM JOIN INSERT UPDATE DELETE",
        "stored_procs":  "stored procedure CALL callproc EXEC execute_procedure",
        "kafka_topics":  "kafka topic producer send KafkaListener consumer subscribe",
        "api_endpoints": "route endpoint GET POST PUT DELETE app.route GetMapping RequestMapping",
        "service_names": "Service class annotation component business logic",
    }

    results: dict[str, list[str]] = {k: [] for k in queries}

    async def _query(key: str, q: str) -> None:
        try:
            proc = await asyncio.create_subprocess_exec(
                "graphify", "query", q,
                cwd=project_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            raw = stdout.decode(errors="replace")
            results[key] = _parse_graphify_output(key, raw)
        except Exception as e:
            logger.debug("graphify query '%s' failed: %s", key, e)

    await asyncio.gather(*[_query(k, q) for k, q in queries.items()])

    return CodeEntities(
        db_tables=results["db_tables"],
        stored_procs=results["stored_procs"],
        kafka_topics=results["kafka_topics"],
        api_endpoints=results["api_endpoints"],
        service_names=results["service_names"],
        source="codegraph",
    )


def _parse_graphify_output(category: str, raw: str) -> list[str]:
    """Extract identifiers from graphify query output."""
    items: set[str] = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        # graphify outputs "symbol: file:line" or JSON nodes
        if line.startswith("{"):
            try:
                obj = json.loads(line)
                name = obj.get("name") or obj.get("symbol") or ""
                if name:
                    items.add(name)
            except json.JSONDecodeError:
                pass
        else:
            # plain text — take first token
            token = line.split(":")[0].split()[0].strip('"\'')
            if token and len(token) > 1:
                items.add(token)
    return sorted(items)[:50]


# ─── Regex fallback strategy ──────────────────────────────────────────────────

# Language-aware patterns keyed by (category, pattern)
_PATTERNS: dict[str, list[str]] = {
    "db_tables": [
        r'(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+[`"\']?(\w+)[`"\']?',
        r'(?:from|join|into|update|table)\s+[`"\']?(\w+)[`"\']?',
        r'tableName\s*[=:]\s*["\'](\w+)["\']',
        r'@Table\s*\(\s*name\s*=\s*["\'](\w+)["\']',
        r'__tablename__\s*=\s*["\'](\w+)["\']',
    ],
    "stored_procs": [
        r'(?:CALL|EXEC(?:UTE)?)\s+(\w+)\s*\(',
        r'(?:call|exec(?:ute)?)\s+(\w+)\s*\(',
        r'callproc\s*\(\s*["\'](\w+)["\']',
        r'execute_procedure\s*\(\s*["\'](\w+)["\']',
        r'StoredProcedure\s*\(\s*["\'](\w+)["\']',
    ],
    "kafka_topics": [
        r'(?:producer\.send|ProducerRecord)\s*\(\s*["\']([^"\']+)["\']',
        r'@KafkaListener\s*\(\s*topics\s*=\s*["\']([^"\']+)["\']',
        r'topics\s*=\s*\[\s*["\']([^"\']+)["\']',
        r'subscribe\s*\(\s*\[\s*["\']([^"\']+)["\']',
        r'KAFKA_TOPIC(?:S)?\s*=\s*["\']([^"\']+)["\']',
    ],
    "api_endpoints": [
        r'@app\.(?:route|get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)["\']',
        r'@(?:Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["\']([^"\']+)["\']',
        r'@RequestMapping\s*\(\s*["\']([^"\']+)["\']',
        r'router\.(?:get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)["\']',
        r'app\.(?:get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)["\']',
    ],
    "service_names": [
        r'class\s+(\w+Service)\b',
        r'@Service\s*\n\s*(?:public\s+)?class\s+(\w+)',
        r'@Injectable\s*\(\)\s*\n\s*export\s+class\s+(\w+)',
    ],
    "env_references": [
        r'os\.environ\.get\s*\(\s*["\']([^"\']+)["\']',
        r'os\.getenv\s*\(\s*["\']([^"\']+)["\']',
        r'process\.env\.(\w+)',
        r'System\.getenv\s*\(\s*["\']([^"\']+)["\']',
    ],
}

_SKIP_WORDS = frozenset({
    "select", "where", "from", "join", "table", "index", "view",
    "dual", "null", "true", "false", "and", "or", "not",
    "int", "varchar", "text", "bigint", "boolean",
})

_SOURCE_EXTENSIONS = frozenset({
    ".py", ".java", ".kt", ".ts", ".tsx", ".js", ".jsx",
    ".go", ".cs", ".rb", ".php", ".scala",
})


async def _extract_via_regex(
    project_path: str,
    file_paths: list[str],
    stream_id: Optional[str],
) -> CodeEntities:
    await emit_task_event(stream_id, EventType.AGENT_REQUEST,
                          phase=PhaseType.EXTRACT,
                          message="🔍 Regex 기반 엔티티 추출 중...")

    base = Path(project_path)
    if file_paths:
        targets = [base / fp for fp in file_paths if Path(fp).suffix in _SOURCE_EXTENSIONS]
    else:
        targets = [
            p for p in base.rglob("*")
            if p.is_file() and p.suffix in _SOURCE_EXTENSIONS
            and not any(part in {".git", "node_modules", "__pycache__", ".venv", "dist", "build"}
                        for part in p.parts)
        ]

    async def _read(path: Path) -> str:
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, path.read_text, "utf-8", "replace")
        except Exception:
            return ""

    contents = await asyncio.gather(*[_read(t) for t in targets])

    buckets: dict[str, set[str]] = {k: set() for k in _PATTERNS}
    for content in contents:
        for category, patterns in _PATTERNS.items():
            for pat in patterns:
                for m in re.finditer(pat, content, re.IGNORECASE):
                    val = m.group(1).strip()
                    if val and val.lower() not in _SKIP_WORDS and len(val) > 1:
                        buckets[category].add(val)

    return CodeEntities(
        db_tables=sorted(buckets["db_tables"])[:50],
        stored_procs=sorted(buckets["stored_procs"])[:30],
        kafka_topics=sorted(buckets["kafka_topics"])[:30],
        api_endpoints=sorted(buckets["api_endpoints"])[:50],
        service_names=sorted(buckets["service_names"])[:30],
        env_references=sorted(buckets["env_references"])[:30],
        source="regex",
    )


# ─── Indexing ─────────────────────────────────────────────────────────────────

class EnsureIndicesRequest(BaseModel):
    project_path: str
    stream_id: Optional[str] = None


@router.post("/api/code/ensure-indices")
async def ensure_indices(req: EnsureIndicesRequest) -> dict[str, Any]:
    """Synchronously build Graphify + CodeGraph indices before analysis starts.

    Called after Phase 1 (file scan) and before Phase 2b (ToC LLM call) so
    that all downstream phases benefit from both indices on the very first run.
    Both indexers run in parallel; the endpoint returns once both complete.
    """
    import shutil

    project_path = req.project_path.rstrip("/")
    stream_id = req.stream_id

    tasks = []

    graph_json = Path(project_path) / "graphify-out" / "graph.json"
    need_graphify = not graph_json.exists()
    if need_graphify:
        await emit_task_event(stream_id, EventType.AGENT_LOG,
                              phase=PhaseType.INDEXING,
                              message="🔧 Graphify 인덱싱 시작 (첫 실행)...")
        tasks.append(_run_graphify_update(project_path))

    codegraph_db = Path(project_path) / ".codegraph" / "index.db"
    need_codegraph = not codegraph_db.exists() and bool(shutil.which("npx"))
    if need_codegraph:
        await emit_task_event(stream_id, EventType.AGENT_LOG,
                              phase=PhaseType.INDEXING,
                              message="🔧 CodeGraph 인덱싱 시작 (첫 실행)...")
        tasks.append(_run_codegraph_init(project_path))

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        await emit_task_event(stream_id, EventType.AGENT_LOG,
                              phase=PhaseType.INDEXING,
                              message="✅ 인덱싱 완료 — Graphify + CodeGraph 준비됨")

    return {
        "graphify": graph_json.exists(),
        "codegraph": codegraph_db.exists(),
        "indexed": bool(tasks),
    }


async def _run_graphify_update(project_path: str) -> None:
    """Run `graphify update <path>` and await completion."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "graphify", "update", project_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=300)
        logger.info("graphify index complete for %s", project_path)
    except Exception as e:
        logger.warning("graphify index failed for %s: %s", project_path, e)


async def _run_codegraph_init(project_path: str) -> None:
    """Run `npx @colbymchenry/codegraph init -i` inside the project directory."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "npx", "@colbymchenry/codegraph", "init", "-i",
            cwd=project_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=300)
        logger.info("codegraph index complete for %s", project_path)
    except Exception as e:
        logger.warning("codegraph init failed for %s: %s", project_path, e)


async def _background_index(project_path: str) -> None:
    """Legacy: run `graphify update <path>` in background (kept for compatibility)."""
    await _run_graphify_update(project_path)
