"""
Search and structured query engine for SUNDAY.
FTS5 full text search + structured lookup.
"""
from typing import List, Dict, Any, Optional
from app.memory.db import DatabaseManager, db_manager
from app.memory.repositories import MemoryNoteRepository, ContactRepository, DocumentRepository


class SearchEngine:
    def __init__(self, db: DatabaseManager = db_manager):
        self.db = db
        self.notes_repo = MemoryNoteRepository(db)
        self.contacts_repo = ContactRepository(db)
        self.docs_repo = DocumentRepository(db)

    def search_all(self, query: str) -> Dict[str, Any]:
        """Unified search across memory notes, contacts, and documents."""
        notes = self.notes_repo.search_notes(query)
        contacts = self.contacts_repo.find_by_name(query)
        return {
            "query": query,
            "notes": [n.__dict__ for n in notes],
            "contacts": [c.__dict__ for c in contacts]
        }


search_engine = SearchEngine()

