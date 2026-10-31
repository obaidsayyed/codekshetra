"""
Data models for persistent SQLite memory in SUNDAY.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any


@dataclass
class BusinessProfile:
    id: str = "default"
    business_name: str = "My Business"
    preferences_json: str = "{}"
    default_currency: str = "INR"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class Contact:
    id: str
    name: str
    role: str = "Customer"
    phone_local: str = ""
    email_local: str = ""
    notes: str = ""
    source: str = "user"
    last_verified_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class DocumentRecord:
    id: str
    path: str
    type: str
    title: str = ""
    checksum: str = ""
    source: str = "generated"
    extracted_json: str = "{}"
    validation_status: str = "valid"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class TaskStepRecord:
    id: str
    task_id: str
    step_order: int
    tool_name: str
    arguments_json: str
    state: str = "queued"  # queued, ready, running, waiting_for_owner, waiting_for_resource, completed, failed, cancelled
    result_json: str = "{}"
    checkpoint: str = ""
    risk_level: str = "R0"


@dataclass
class TaskRecord:
    id: str
    parent_id: Optional[str] = None
    title: str = ""
    state: str = "queued"
    risk: str = "R0"
    due_at: Optional[str] = None
    next_run_at: Optional[str] = None
    retry_count: int = 0
    idempotency_key: Optional[str] = None
    waiting_resource: Optional[str] = None  # e.g. "internet_connection"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class ApprovalRecord:
    id: str
    task_step_id: Optional[str] = None
    action_hash: str = ""
    spoken_prompt: str = ""
    expires_at: str = ""
    status: str = "pending"  # pending, confirmed, rejected, expired
    confirmed_at: Optional[str] = None
    voice_phrase: str = ""


@dataclass
class MemoryNote:
    id: str
    topic: str
    note: str
    source_ref: str = "user_dictation"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    expiry: Optional[str] = None
