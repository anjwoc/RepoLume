PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    repo        TEXT NOT NULL,
    language    TEXT NOT NULL DEFAULT 'en',
    model       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    metadata    TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
    id             TEXT PRIMARY KEY,
    project_id     TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    current_phase  TEXT,
    page_total     INTEGER DEFAULT 0,
    page_done      INTEGER DEFAULT 0,
    page_failed    INTEGER DEFAULT 0,
    started_at     TEXT NOT NULL,
    completed_at   TEXT,
    duration_ms    INTEGER,
    error          TEXT,
    parent_job_id  TEXT REFERENCES jobs(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS page_checkpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       TEXT    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    page_id      TEXT    NOT NULL,
    page_title   TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'completed',
    completed_at TEXT    NOT NULL,
    content      TEXT    NOT NULL DEFAULT '',
    UNIQUE(job_id, page_id)
);

CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id   TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    type     TEXT NOT NULL,
    phase    TEXT,
    message  TEXT NOT NULL DEFAULT '',
    data     TEXT NOT NULL DEFAULT '{}',
    ts       TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_job_id    ON events(job_id);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_jobs_project     ON jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_checkpoints_job  ON page_checkpoints(job_id);
