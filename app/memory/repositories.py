"""
Repositories for database entities in SUNDAY.
"""
import json
import sqlite3
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from app.memory.db import DatabaseManager, db_manager
from app.memory.models import (
    BusinessProfile, Contact, DocumentRecord, TaskRecord,
    TaskStepRecord, ApprovalRecord, MemoryNote
)
from app.audit.events import AuditEvent


class TaskRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def save_task(self, task: TaskRecord) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO tasks (id, parent_id, title, state, risk, due_at, next_run_at, retry_count, idempotency_key, waiting_resource, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    state=excluded.state,
                    risk=excluded.risk,
                    due_at=excluded.due_at,
                    next_run_at=excluded.next_run_at,
                    retry_count=excluded.retry_count,
                    waiting_resource=excluded.waiting_resource,
                    updated_at=excluded.updated_at
                """,
                (task.id, task.parent_id, task.title, task.state, task.risk, task.due_at,
                 task.next_run_at, task.retry_count, task.idempotency_key, task.waiting_resource,
                 task.created_at, task.updated_at)
            )

    def get_task(self, task_id: str) -> Optional[TaskRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return TaskRecord(**dict(row))

    def save_step(self, step: TaskStepRecord) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO task_steps (id, task_id, step_order, tool_name, arguments_json, state, result_json, checkpoint, risk_level)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    state=excluded.state,
                    result_json=excluded.result_json,
                    checkpoint=excluded.checkpoint,
                    risk_level=excluded.risk_level
                """,
                (step.id, step.task_id, step.step_order, step.tool_name,
                 step.arguments_json, step.state, step.result_json, step.checkpoint, step.risk_level)
            )

    def get_steps_for_task(self, task_id: str) -> List[TaskStepRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order ASC", (task_id,))
            return [TaskStepRecord(**dict(row)) for row in cursor.fetchall()]

    def get_step(self, step_id: str) -> Optional[TaskStepRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM task_steps WHERE id = ?", (step_id,))
            row = cursor.fetchone()
            return TaskStepRecord(**dict(row)) if row else None

    def get_tasks_by_states(self, states: List[str]) -> List[TaskRecord]:
        placeholders = ",".join("?" for _ in states)
        with self.db.transaction() as conn:
            cursor = conn.execute(f"SELECT * FROM tasks WHERE state IN ({placeholders}) ORDER BY created_at ASC", tuple(states))
            return [TaskRecord(**dict(row)) for row in cursor.fetchall()]


class ApprovalRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def save_approval(self, apprv: ApprovalRecord) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO approvals (id, task_step_id, action_hash, spoken_prompt, expires_at, status, confirmed_at, voice_phrase)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status=excluded.status,
                    confirmed_at=excluded.confirmed_at,
                    voice_phrase=excluded.voice_phrase
                """,
                (apprv.id, apprv.task_step_id, apprv.action_hash, apprv.spoken_prompt,
                 apprv.expires_at, apprv.status, apprv.confirmed_at, apprv.voice_phrase)
            )

    def get_approval(self, approval_id: str) -> Optional[ApprovalRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM approvals WHERE id = ?", (approval_id,))
            row = cursor.fetchone()
            return ApprovalRecord(**dict(row)) if row else None

    def get_pending_by_step(self, step_id: str) -> Optional[ApprovalRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM approvals WHERE task_step_id = ? AND status = 'pending'", (step_id,))
            row = cursor.fetchone()
            return ApprovalRecord(**dict(row)) if row else None


class ContactRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def save_contact(self, contact: Contact) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO contacts (id, name, role, phone_local, email_local, notes, source, last_verified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    role=excluded.role,
                    phone_local=excluded.phone_local,
                    email_local=excluded.email_local,
                    notes=excluded.notes,
                    last_verified_at=excluded.last_verified_at
                """,
                (contact.id, contact.name, contact.role, contact.phone_local,
                 contact.email_local, contact.notes, contact.source, contact.last_verified_at)
            )

    def find_by_name(self, query: str) -> List[Contact]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM contacts WHERE name LIKE ? ORDER BY name ASC", (f"%{query}%",))
            return [Contact(**dict(row)) for row in cursor.fetchall()]

    def get_contact(self, contact_id: str) -> Optional[Contact]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
            row = cursor.fetchone()
            return Contact(**dict(row)) if row else None


class DocumentRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def save_document(self, doc: DocumentRecord) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO documents (id, path, type, title, checksum, source, extracted_json, validation_status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    checksum=excluded.checksum,
                    extracted_json=excluded.extracted_json,
                    validation_status=excluded.validation_status
                """,
                (doc.id, doc.path, doc.type, doc.title, doc.checksum,
                 doc.source, doc.extracted_json, doc.validation_status, doc.created_at)
            )

    def get_by_path(self, path: str) -> Optional[DocumentRecord]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM documents WHERE path = ?", (path,))
            row = cursor.fetchone()
            return DocumentRecord(**dict(row)) if row else None


class AuditEventRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def log_event(self, event: AuditEvent) -> int:
        with self.db.transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO audit_events (timestamp, task_id, tool_name, action, params_redacted, result, evidence_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (event.timestamp, event.task_id, event.tool_name,
                 event.action, event.params_redacted, event.result, event.evidence_path)
            )
            return cursor.lastrowid

    def get_recent(self, limit: int = 50) -> List[AuditEvent]:
        with self.db.transaction() as conn:
            cursor = conn.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (limit,))
            return [AuditEvent(**dict(row)) for row in cursor.fetchall()]


class MemoryNoteRepository:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db

    def save_note(self, note: MemoryNote) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO memory_notes (id, topic, note, source_ref, created_at, expiry)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    topic=excluded.topic,
                    note=excluded.note,
                    expiry=excluded.expiry
                """,
                (note.id, note.topic, note.note, note.source_ref, note.created_at, note.expiry)
            )

    def search_notes(self, query: str) -> List[MemoryNote]:
        with self.db.transaction() as conn:
            cursor = conn.execute(
                """
                SELECT m.* FROM memory_notes m
                JOIN memory_notes_fts f ON m.id = f.id
                WHERE memory_notes_fts MATCH ?
                ORDER BY rank
                """,
                (query,)
            )
            rows = cursor.fetchall()
            if not rows:
                # Fallback to simple like
                cursor = conn.execute(
                    "SELECT * FROM memory_notes WHERE topic LIKE ? OR note LIKE ?",
                    (f"%{query}%", f"%{query}%")
                )
                rows = cursor.fetchall()
            return [MemoryNote(**dict(r)) for r in rows]

