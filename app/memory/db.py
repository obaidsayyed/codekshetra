"""
SQLite database connection and schema management for SUNDAY.
Supports WAL mode, transactions, migrations, and FTS5 full-text search.
"""
import sqlite3
import shutil
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timezone
from app.config.settings import settings
from app.audit.logger import audit_logger


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS business_profile (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    default_currency TEXT NOT NULL DEFAULT 'INR',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Customer',
    phone_local TEXT DEFAULT '',
    email_local TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    source TEXT DEFAULT 'user',
    last_verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT DEFAULT '',
    checksum TEXT DEFAULT '',
    source TEXT DEFAULT 'generated',
    extracted_json TEXT DEFAULT '{}',
    validation_status TEXT DEFAULT 'valid',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    title TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    risk TEXT NOT NULL DEFAULT 'R0',
    due_at TEXT,
    next_run_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT UNIQUE,
    waiting_resource TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT NOT NULL DEFAULT '{}',
    checkpoint TEXT DEFAULT '',
    risk_level TEXT NOT NULL DEFAULT 'R0',
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    task_step_id TEXT,
    action_hash TEXT NOT NULL,
    spoken_prompt TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confirmed_at TEXT,
    voice_phrase TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    task_id TEXT,
    tool_name TEXT,
    action TEXT NOT NULL,
    params_redacted TEXT,
    result TEXT,
    evidence_path TEXT
);

CREATE TABLE IF NOT EXISTS memory_notes (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    note TEXT NOT NULL,
    source_ref TEXT DEFAULT 'user_dictation',
    created_at TEXT NOT NULL,
    expiry TEXT
);

-- Full text search for notes
CREATE VIRTUAL TABLE IF NOT EXISTS memory_notes_fts USING fts5(
    id UNINDEXED,
    topic,
    note,
    content='memory_notes',
    content_rowid='rowid'
);

-- Triggers to keep FTS updated
CREATE TRIGGER IF NOT EXISTS memory_notes_ai AFTER INSERT ON memory_notes BEGIN
    INSERT INTO memory_notes_fts(rowid, id, topic, note) VALUES (new.rowid, new.id, new.topic, new.note);
END;
CREATE TRIGGER IF NOT EXISTS memory_notes_ad AFTER DELETE ON memory_notes BEGIN
    INSERT INTO memory_notes_fts(memory_notes_fts, rowid, id, topic, note) VALUES('delete', old.rowid, old.id, old.topic, old.note);
END;
CREATE TRIGGER IF NOT EXISTS memory_notes_au AFTER UPDATE ON memory_notes BEGIN
    INSERT INTO memory_notes_fts(memory_notes_fts, rowid, id, topic, note) VALUES('delete', old.rowid, old.id, old.topic, old.note);
    INSERT INTO memory_notes_fts(rowid, id, topic, note) VALUES (new.rowid, new.id, new.topic, new.note);
END;
"""


class DatabaseManager:
    def __init__(self, db_path: Path = None):
        self.db_path = db_path or settings.db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    @contextmanager
    def transaction(self):
        conn = self.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_db(self):
        with self.transaction() as conn:
            conn.executescript(SCHEMA_SQL)
            # Insert default business profile if not present
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM business_profile WHERE id='default'")
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "INSERT INTO business_profile (id, business_name, preferences_json, default_currency, created_at) VALUES (?, ?, ?, ?, ?)",
                    ("default", "ABC Enterprises", "{}", "INR", datetime.now(timezone.utc).isoformat())
                )
        audit_logger.info("Initialized SQLite database schema with FTS5 at %s", self.db_path)

    def backup(self, destination: Path = None) -> Path:
        if destination is None:
            now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            destination = settings.backups_dir / f"sunday_backup_{now_str}.db"
        destination.parent.mkdir(parents=True, exist_ok=True)
        
        with self.get_connection() as src_conn:
            dest_conn = sqlite3.connect(str(destination))
            src_conn.backup(dest_conn)
            dest_conn.close()
            
        audit_logger.info("Created SQLite database backup at %s", destination)
        return destination


db_manager = DatabaseManager()
