"""
Multi-turn conversation memory manager for SUNDAY.
Persists dialogue history across turns so SUNDAY understands conversational context,
clarifications, follow-ups, and natural human dialogue.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import sqlite3
from app.memory.db import db_manager, DatabaseManager
from app.audit.logger import audit_logger


@dataclass
class ConversationTurn:
    id: Optional[int]
    timestamp: str
    role: str  # 'user' or 'assistant'
    content: str


CONV_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS conversation_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


class ConversationManager:
    def __init__(self, db: DatabaseManager = db_manager, memory_limit: int = 12):
        self.db = db
        self.memory_limit = memory_limit
        self._active_document: Optional[Dict[str, Any]] = None
        self._init_table()
        self._cache: List[Dict[str, str]] = []
        self._load_cache()

    def set_active_document(
        self,
        title: str,
        text: str,
        app_choice: str = "word",
        path: Optional[str] = None,
        topic: Optional[str] = None
    ) -> None:
        """Stores context of the most recently created or edited document/essay."""
        self._active_document = {
            "title": title,
            "text": text,
            "app_choice": app_choice,
            "path": path,
            "topic": topic or title
        }
        audit_logger.info("Updated active document context: '%s' (%s)", title, app_choice)

    def get_active_document(self) -> Optional[Dict[str, Any]]:
        """Returns the active document context dictionary, if any."""
        return self._active_document

    def clear_active_document(self) -> None:
        self._active_document = None

    def _init_table(self):
        with self.db.transaction() as conn:
            conn.executescript(CONV_SCHEMA_SQL)

    def _load_cache(self):
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "SELECT role, content FROM conversation_turns ORDER BY id DESC LIMIT ?",
                (self.memory_limit,)
            )
            rows = cursor.fetchall()
            # Reverse to get chronological order
            self._cache = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def add_turn(self, role: str, content: str):
        now = datetime.now(timezone.utc).isoformat()
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO conversation_turns (timestamp, role, content) VALUES (?, ?, ?)",
                (now, role, content)
            )
        self._cache.append({"role": role, "content": content})
        if len(self._cache) > self.memory_limit:
            self._cache.pop(0)
        audit_logger.debug("Added %s turn to conversation memory: '%s'", role, content[:50])

    def get_recent_history(self, limit: int = 8) -> List[Dict[str, str]]:
        """Returns the recent turns formatted as Ollama chat messages."""
        return self._cache[-limit:]

    def get_last_turn(self) -> Optional[Dict[str, str]]:
        """Returns the single most recent turn from history."""
        if self._cache:
            return self._cache[-1]
        return None

    def get_last_assistant_turn(self) -> Optional[Dict[str, str]]:
        """Returns the most recent assistant message from history."""
        for turn in reversed(self._cache):
            if turn["role"] == "assistant":
                return turn
        return None

    def get_last_user_turn(self) -> Optional[Dict[str, str]]:
        """Returns the most recent user message from history."""
        for turn in reversed(self._cache):
            if turn["role"] == "user":
                return turn
        return None

    def format_history_for_prompt(self, limit: int = 6) -> str:
        """Formats recent dialogue history as context text."""
        recent = self._cache[-limit:]
        if not recent:
            return "No previous conversation."
        lines = []
        for turn in recent:
            speaker = "User" if turn["role"] == "user" else "SUNDAY"
            lines.append(f"{speaker}: {turn['content']}")
        return "\n".join(lines)

    def add_meeting_reminder(self, title: str, date_str: str, time_str: str) -> Dict[str, Any]:
        """Saves a meeting reminder to SQLite and in-memory context."""
        now = datetime.now(timezone.utc).isoformat()
        with self.db.transaction() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS meeting_reminders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    date_str TEXT NOT NULL,
                    time_str TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO meeting_reminders (title, date_str, time_str, created_at) VALUES (?, ?, ?, ?)",
                (title, date_str, time_str, now)
            )
        reminder = {"title": title, "date": date_str, "time": time_str, "created_at": now}
        self._last_meeting = reminder
        audit_logger.info("Saved meeting reminder: '%s' on %s at %s", title, date_str, time_str)
        return reminder

    def get_upcoming_meetings(self, date_str: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.db.transaction() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS meeting_reminders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    date_str TEXT NOT NULL,
                    time_str TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            if date_str:
                cursor = conn.execute(
                    "SELECT title, date_str, time_str FROM meeting_reminders WHERE LOWER(date_str) = LOWER(?) ORDER BY id DESC LIMIT 5",
                    (date_str,)
                )
            else:
                cursor = conn.execute("SELECT title, date_str, time_str FROM meeting_reminders ORDER BY id DESC LIMIT 5")
            rows = cursor.fetchall()
            return [{"title": r["title"], "date": r["date_str"], "time": r["time_str"], "time_str": r["time_str"]} for r in rows]

    def clear(self):
        self._cache.clear()
        self._active_document = None
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM conversation_turns")
            conn.execute("DELETE FROM meeting_reminders")
        audit_logger.info("Conversation memory cleared.")


conversation_manager = ConversationManager()
