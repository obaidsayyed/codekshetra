"""
Voice-based approval manager for SUNDAY.
Binds spoken approvals to exact tool parameters using cryptographic SHA-256 hashes.
Strictly voice-driven: no command typing required.
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple
from app.memory.models import ApprovalRecord
from app.memory.repositories import ApprovalRepository
from app.audit.logger import audit_logger
from app.audit.events import AuditEvent
from app.audit.logger import redact_secrets


AFFIRMATIVE_PHRASES = {
    "yes", "i approve", "approve", "confirm", "confirmed",
    "proceed", "go ahead", "okay", "ok", "sure", "do it", "grant"
}

NEGATIVE_PHRASES = {
    "no", "don't", "do not", "cancel", "stop", "abort", "reject", "revoke", "deny", "never mind"
}


class ApprovalManager:
    def __init__(self, approval_repo: Optional[ApprovalRepository] = None):
        self.repo = approval_repo or ApprovalRepository()

    @staticmethod
    def compute_action_hash(tool_name: str, arguments: Dict[str, Any]) -> str:
        payload = {
            "tool": tool_name,
            "args": arguments
        }
        serialized = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    def create_request(
        self,
        task_step_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        spoken_prompt: str,
        validity_seconds: int = 120
    ) -> ApprovalRecord:
        action_hash = self.compute_action_hash(tool_name, arguments)
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=validity_seconds)).isoformat()
        
        record = ApprovalRecord(
            id=str(uuid.uuid4()),
            task_step_id=task_step_id,
            action_hash=action_hash,
            spoken_prompt=spoken_prompt,
            expires_at=expires_at,
            status="pending"
        )
        self.repo.save_approval(record)
        audit_logger.info(
            "Created spoken approval request %s for %s (hash: %s): '%s'",
            record.id, tool_name, action_hash[:8], spoken_prompt
        )
        return record

    def evaluate_voice_response(
        self,
        approval_id: str,
        spoken_text: str,
        current_tool_name: str,
        current_arguments: Dict[str, Any]
    ) -> Tuple[bool, str]:
        """
        Evaluates owner's spoken response against the pending approval.
        Returns (is_approved: bool, explanation: str).
        """
        record = self.repo.get_approval(approval_id)
        if not record:
            return False, "Approval record not found."
            
        if record.status != "pending":
            return False, f"Approval is no longer pending (current status: {record.status})."
            
        # 1. Check expiration
        now = datetime.now(timezone.utc).isoformat()
        if now > record.expires_at:
            record.status = "expired"
            self.repo.save_approval(record)
            return False, "Voice approval has expired. Please repeat the request."

        # 2. Check parameter hash integrity (AT-11: Change action parameters after approval -> invalid)
        current_hash = self.compute_action_hash(current_tool_name, current_arguments)
        if current_hash != record.action_hash:
            record.status = "invalidated"
            self.repo.save_approval(record)
            return False, "Action parameters were altered since approval prompt. Approval invalidated."

        # 3. Clean and evaluate spoken transcript
        cleaned = spoken_text.strip().lower()
        # Remove punctuation
        for ch in [".", ",", "!", "?", ";"]:
            cleaned = cleaned.replace(ch, "")
            
        # Check negative phrases first
        for neg in NEGATIVE_PHRASES:
            if neg in cleaned.split() or cleaned == neg:
                record.status = "rejected"
                record.confirmed_at = now
                record.voice_phrase = spoken_text
                self.repo.save_approval(record)
                audit_logger.info("Voice approval %s explicitly rejected by owner with: '%s'", approval_id, spoken_text)
                return False, f"Permission revoked or cancelled by voice: '{spoken_text}'"

        # Check affirmative phrases
        matched = False
        for aff in AFFIRMATIVE_PHRASES:
            if aff in cleaned:
                matched = True
                break

        if matched:
            record.status = "confirmed"
            record.confirmed_at = now
            record.voice_phrase = spoken_text
            self.repo.save_approval(record)
            audit_logger.info("Voice approval %s confirmed by owner with: '%s'", approval_id, spoken_text)
            return True, "Approval confirmed by voice."

        # Ambiguous or mismatched phrase (AT-10: Vague or mismatched approval -> reject)
        audit_logger.warning("Spoken response '%s' was ambiguous or mismatched. Approval remains pending.", spoken_text)
        return False, f"Unrecognized spoken response: '{spoken_text}'. Please say 'I approve' or 'cancel'."


approval_manager = ApprovalManager()

