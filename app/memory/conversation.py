"""
Multi-turn conversation memory manager for SUNDAY.
Persists dialogue history across turns so SUNDAY understands conversational context,
clarifications, follow-ups, and natural human dialogue.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Dict, Optional
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
"""


class ConversationManager:
    def __init__(self, db: DatabaseManager = db_manager, memory_limit: int = 12):
        self.db = db
        self.memory_limit = memory_limit
        self._init_table()
        self._cache: List[Dict[str, str]] = []
        self._load_cache()

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

    def clear(self):
        self._cache.clear()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM conversation_turns")
        audit_logger.info("Conversation memory cleared.")


conversation_manager = ConversationManager()
