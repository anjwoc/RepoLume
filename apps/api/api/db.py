"""
api/db.py — 로컬 SQLite 프로젝트 레지스트리

외부 의존성 없음 (Python 내장 sqlite3 사용).
Electron 번들 환경 포함, 어떤 실행 방식에서도 동작합니다.

DB 위치: ~/.localwiki/projects.db
"""
import sqlite3
import os
import time
import glob
import json
import logging
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── DB 경로 ────────────────────────────────────────────────────────────────────
_DB_DIR = Path.home() / ".localwiki"
_DB_PATH = _DB_DIR / "projects.db"

# 스레드 안전을 위한 락 (FastAPI는 멀티스레드 환경)
_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    """커넥션 생성 — check_same_thread=False 로 멀티스레드 환경 지원."""
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # 동시 읽기/쓰기 성능
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ── 초기화 ─────────────────────────────────────────────────────────────────────
def init_db() -> None:
    """
    DB 파일과 테이블을 초기화합니다.
    서버 시작 시 1회 호출. 이미 존재하면 스키마만 검증합니다.
    """
    _DB_DIR.mkdir(parents=True, exist_ok=True)

    with _lock:
        conn = _get_conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS projects (
                    id          TEXT PRIMARY KEY,       -- "owner/repo" 형태
                    owner       TEXT NOT NULL,
                    repo        TEXT NOT NULL,
                    repo_type   TEXT NOT NULL DEFAULT 'local',
                    local_path  TEXT,                   -- 소스 디렉토리 절대 경로 (핵심)
                    created_at  INTEGER NOT NULL,
                    updated_at  INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS wiki_runs (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id      TEXT NOT NULL REFERENCES projects(id),
                    language        TEXT NOT NULL,
                    model           TEXT NOT NULL DEFAULT '',
                    provider        TEXT,
                    cache_path      TEXT,               -- JSON 캐시 파일 경로
                    generated_at    INTEGER NOT NULL,
                    UNIQUE(project_id, language, model)
                );

                CREATE INDEX IF NOT EXISTS idx_projects_owner_repo
                    ON projects(owner, repo);

                CREATE INDEX IF NOT EXISTS idx_wiki_runs_project
                    ON wiki_runs(project_id, language, model);
            """)
            conn.commit()
            logger.info(f"[db] SQLite 레지스트리 초기화 완료: {_DB_PATH}")
        finally:
            conn.close()

    # 기존 JSON 캐시에서 localPath 마이그레이션 (1회성)
    _migrate_from_json_cache()


# ── 프로젝트 CRUD ───────────────────────────────────────────────────────────────
def upsert_project(
    owner: str,
    repo: str,
    repo_type: str = "local",
    local_path: Optional[str] = None,
) -> None:
    """프로젝트를 등록하거나 갱신합니다. local_path가 유효한 절대 경로일 때만 저장."""
    if local_path and not (os.path.isabs(local_path) and os.path.isdir(local_path)):
        logger.warning(f"[db] upsert_project: 유효하지 않은 local_path 무시 — {local_path!r}")
        local_path = None

    project_id = f"{owner}/{repo}"
    now = int(time.time())

    with _lock:
        conn = _get_conn()
        try:
            conn.execute("""
                INSERT INTO projects (id, owner, repo, repo_type, local_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    repo_type  = excluded.repo_type,
                    local_path = COALESCE(excluded.local_path, projects.local_path),
                    updated_at = excluded.updated_at
            """, (project_id, owner, repo, repo_type, local_path, now, now))
            conn.commit()
            logger.info(f"[db] 프로젝트 등록/갱신: {project_id}, local_path={local_path}")
        finally:
            conn.close()


def get_project_local_path(owner: str, repo: str) -> Optional[str]:
    """
    소스 디렉토리 절대 경로를 반환합니다.
    존재하지 않거나 경로가 유효하지 않으면 None.
    """
    project_id = f"{owner}/{repo}"
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT local_path FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if row and row["local_path"] and os.path.isdir(row["local_path"]):
            return row["local_path"]
        return None
    finally:
        conn.close()


def list_projects() -> list:
    """
    등록된 모든 프로젝트를 반환합니다.
    wiki_runs와 JOIN해서 언어·모델 목록도 포함합니다.
    """
    conn = _get_conn()
    try:
        rows = conn.execute("""
            SELECT
                p.id,
                p.owner,
                p.repo,
                p.repo_type,
                p.local_path,
                p.created_at,
                p.updated_at,
                r.language,
                r.model,
                r.provider,
                r.cache_path,
                r.generated_at
            FROM projects p
            LEFT JOIN wiki_runs r ON r.project_id = p.id
            ORDER BY r.generated_at DESC, p.updated_at DESC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── 위키 생성 이력 ─────────────────────────────────────────────────────────────
def upsert_wiki_run(
    owner: str,
    repo: str,
    language: str,
    model: str,
    provider: Optional[str] = None,
    cache_path: Optional[str] = None,
) -> None:
    """위키 생성 이력을 기록합니다. (언어·모델 조합별 upsert)"""
    project_id = f"{owner}/{repo}"
    now = int(time.time())

    with _lock:
        conn = _get_conn()
        try:
            conn.execute("""
                INSERT INTO wiki_runs (project_id, language, model, provider, cache_path, generated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, language, model) DO UPDATE SET
                    provider     = excluded.provider,
                    cache_path   = excluded.cache_path,
                    generated_at = excluded.generated_at
            """, (project_id, language, model or "", provider, cache_path, now))
            conn.commit()
        finally:
            conn.close()


# ── JSON 캐시 마이그레이션 (서버 시작 시 1회) ────────────────────────────────
def _migrate_from_json_cache() -> None:
    """
    기존 JSON 캐시 파일에서 localPath를 추출해 DB에 임포트합니다.
    이미 등록된 프로젝트는 COALESCE로 덮어쓰지 않습니다.
    """
    try:
        adalflow_dir = Path.home() / ".adalflow" / "wikicache"
        if not adalflow_dir.exists():
            return

        cache_files = list(adalflow_dir.glob("localwiki_cache_*.json"))
        if not cache_files:
            return

        migrated = 0
        for cache_file in cache_files:
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                repo_obj = data.get("repo") or {}
                owner = repo_obj.get("owner", "")
                repo = repo_obj.get("repo", "")
                repo_type = repo_obj.get("type", "local")
                language = data.get("language", "")
                model = data.get("model", "")
                provider = data.get("provider")

                # localPath 후보: localPath → repoUrl 순
                local_path = None
                for key in ("localPath", "repoUrl"):
                    v = repo_obj.get(key, "")
                    if v and os.path.isabs(v) and os.path.isdir(v):
                        local_path = v
                        break

                if owner and repo:
                    upsert_project(owner, repo, repo_type, local_path)
                    upsert_wiki_run(
                        owner, repo, language, model or "local",
                        provider=provider,
                        cache_path=str(cache_file),
                    )
                    migrated += 1
            except Exception as e:
                logger.debug(f"[db] 마이그레이션 스킵 {cache_file.name}: {e}")

        if migrated:
            logger.info(f"[db] JSON 캐시 마이그레이션 완료: {migrated}개 항목")
    except Exception as e:
        logger.warning(f"[db] 마이그레이션 오류 (무시): {e}")
