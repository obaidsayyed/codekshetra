"""
Audit events definition.
"""
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
import json


class AuditEvent(BaseModel):
    id: Optional[int] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    task_id: Optional[str] = None
    tool_name: Optional[str] = None
    action: str
    params_redacted: Optional[str] = None
    result: Optional[str] = None
    evidence_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()

