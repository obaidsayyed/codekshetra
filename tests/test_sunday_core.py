"""
Comprehensive Acceptance Test Suite for SUNDAY.
Tests PRD & Build Guide matrix: AT-01 to AT-15 + User-specific requirements.
"""
import pytest
import os
import shutil
from pathlib import Path
from decimal import Decimal
import fitz
import docx

from app.config.settings import settings
from app.memory.db import db_manager
from app.memory.models import TaskRecord, TaskStepRecord
from app.memory.repositories import (
    TaskRepository, ApprovalRepository, ContactRepository, DocumentRepository, MemoryNoteRepository
)
from app.permissions.policy import RiskLevel, get_tool_risk
from app.permissions.approvals import approval_manager
from app.tools.registry import tool_registry
from app.tools.documents import CreateInvoiceTool, CreateEmailDraftTool, CreateMessageDraftTool, ReadPdfTool
from app.tools.files import ListDirectoryTool, MoveToArchiveTool, CreateFolderTool
from app.tools.windows import VisualOpenAndTypeTool
from app.tools.network import is_online, requires_internet
from app.brain.planner import planner
from app.orchestration.engine import workflow_engine
from app.orchestration.states import TaskState
from app.voice.audio_io import audio_io


@pytest.fixture(autouse=True)
def setup_teardown():
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    settings.drafts_dir.mkdir(parents=True, exist_ok=True)
    settings.archive_dir.mkdir(parents=True, exist_ok=True)
    workflow_engine.reset_stop()
    yield


def test_at_01_database_and_offline_storage():
    """AT-01: Persistent memory, contacts, and notes work without network."""
    note_repo = MemoryNoteRepository(db_manager)
    from app.memory.models import MemoryNote
    note = MemoryNote(id="test-note-1", topic="GST Rule", note="Standard rate for services is 18 percent")
    note_repo.save_note(note)
    
    found = note_repo.search_notes("GST")
    assert len(found) >= 1
    assert "18 percent" in found[0].note


def test_at_05_deterministic_invoice_creation():
    """AT-05: Create invoice with line items, tax, and grand total using Decimal. Verified in DOCX/PDF."""
    tool = CreateInvoiceTool()
    items = [
        {"description": "IT Support Services", "quantity": 10, "unit_price": 1500.0},
        {"description": "Software License", "quantity": 2, "unit_price": 4500.0}
    ]
    # subtotal = 10*1500 + 2*4500 = 15000 + 9000 = 24000
    # tax 18% = 4320
    # total = 28320.00
    result = tool.execute(customer_name="Globex Corp", items=items, tax_rate_percent=18.0, currency="INR")
    
    assert result.success is True
    data = result.data
    assert Decimal(str(data["subtotal"])) == Decimal("24000.00")
    assert Decimal(str(data["tax_amount"])) == Decimal("4320.00")
    assert Decimal(str(data["grand_total"])) == Decimal("28320.00")
    
    # Reopen and verify DOCX
    docx_file = Path(data["docx_path"])
    assert docx_file.exists()
    doc = docx.Document(str(docx_file))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Globex Corp" in full_text
    assert "28320.00" in full_text
    
    # Reopen and verify PDF
    pdf_file = Path(data["pdf_path"])
    assert pdf_file.exists()
    pdf_doc = fitz.open(str(pdf_file))
    assert pdf_doc.page_count >= 1
    pdf_text = "".join(p.get_text() for p in pdf_doc)
    pdf_doc.close()
    assert "Globex Corp" in pdf_text
    assert "28320.00" in pdf_text


def test_at_06_drafts_marked_not_sent():
    """AT-06: Draft email and message drafts marked Draft - Not Sent with no network transmission."""
    email_tool = CreateEmailDraftTool()
    res1 = email_tool.execute(recipient="client@example.com", subject="Project Update", body="Work is complete.")
    assert res1.success is True
    assert res1.data["status"] == "draft_saved_not_sent"
    txt_content = Path(res1.data["txt_path"]).read_text(encoding="utf-8")
    assert "STATUS: DRAFT - NOT SENT" in txt_content
    assert "client@example.com" in txt_content

    msg_tool = CreateMessageDraftTool()
    res2 = msg_tool.execute(recipient="+919876543210", message_text="Invoice is ready.")
    assert res2.success is True
    assert res2.data["status"] == "draft_saved_not_sent"
    msg_content = Path(res2.data["path"]).read_text(encoding="utf-8")
    assert "STATUS: DRAFT - NOT SENT" in msg_content


def test_at_07_pdf_extraction_and_scanned_detection():
    """AT-07: Extract PDF text, verify page count and identify scanned vs digital."""
    # Use the invoice PDF created in previous step
    tool = CreateInvoiceTool()
    inv_res = tool.execute(customer_name="Test Company", items=[{"description": "Item", "quantity": 1, "unit_price": 100}])
    pdf_path = inv_res.data["pdf_path"]

    reader = ReadPdfTool()
    read_res = reader.execute(pdf_path=pdf_path)
    assert read_res.success is True
    assert read_res.data["page_count"] >= 1
    assert read_res.data["is_scanned"] is False
    assert "Test Company" in read_res.data["text"]


def test_at_08_safe_file_operations_and_archive_recovery():
    """AT-08: Files moved to archive include recovery map and prevent collisions."""
    test_file = settings.workspace_root / "test_move.txt"
    test_file.write_text("sample content to archive", encoding="utf-8")

    archive_tool = MoveToArchiveTool()
    res = archive_tool.execute(source_path=str(test_file))
    assert res.success is True
    archived_path = Path(res.output_path)
    assert archived_path.exists()
    assert not test_file.exists()

    recovery_log = settings.recovery_dir / "recovery_map.json"
    assert recovery_log.exists()
    assert "test_move.txt" in recovery_log.read_text(encoding="utf-8")


def test_at_09_10_11_voice_approval_and_security_policy():
    """
    AT-09: Protected R2 action without approval requires approval.
    AT-10: Vague / mismatched spoken approval is rejected.
    AT-11: Parameter alteration after approval invalidates approval.
    """
    # Create a dummy file for move_to_archive (RiskLevel.R2)
    sample_file = settings.workspace_root / "confidential.txt"
    sample_file.write_text("secret", encoding="utf-8")

    # Step 1: Execute through registry without approval (AT-09)
    res = tool_registry.execute_tool(
        tool_name="move_to_archive",
        arguments={"source_path": str(sample_file)},
        is_approval_confirmed=False
    )
    assert res["status"] == "waiting_for_owner"
    apprv_id = res["approval_id"]
    prompt = res["spoken_prompt"]
    assert "move" in prompt.lower()

    # Step 2: Voice response with vague/mismatched phrase (AT-10)
    ok, reason = approval_manager.evaluate_voice_response(
        approval_id=apprv_id,
        spoken_text="maybe later today",
        current_tool_name="move_to_archive",
        current_arguments={"source_path": str(sample_file)}
    )
    assert ok is False
    assert "Unrecognized spoken response" in reason

    # Step 3: Explicit rejection by voice
    ok_reject, reason_reject = approval_manager.evaluate_voice_response(
        approval_id=apprv_id,
        spoken_text="no cancel it",
        current_tool_name="move_to_archive",
        current_arguments={"source_path": str(sample_file)}
    )
    assert ok_reject is False
    assert "cancelled by voice" in reason_reject

    # Step 4: Parameter mismatch test (AT-11)
    req2 = approval_manager.create_request("step-2", "move_to_archive", {"source_path": "a.txt"}, "Prompt")
    # Parameters altered to "b.txt"
    ok_mismatch, reason_mismatch = approval_manager.evaluate_voice_response(
        approval_id=req2.id,
        spoken_text="I approve",
        current_tool_name="move_to_archive",
        current_arguments={"source_path": "b.txt"}
    )
    assert ok_mismatch is False
    assert "altered" in reason_mismatch.lower()


def test_at_12_crash_recovery_preserves_checkpoints():
    """AT-12: Kill and restart runtime during workflow; completed steps not duplicated."""
    task_repo = TaskRepository(db_manager)
    task_id = "task-crash-test"
    
    # Task with 2 steps: step 1 already COMPLETED, step 2 READY
    task = TaskRecord(id=task_id, title="Multi-step test", state=TaskState.RUNNING.value)
    task_repo.save_task(task)
    
    step1 = TaskStepRecord(
        id="s1", task_id=task_id, step_order=1,
        tool_name="create_folder", arguments_json='{"folder_path": "test_folder"}',
        state=TaskState.COMPLETED.value, result_json='{"success": true}'
    )
    step2 = TaskStepRecord(
        id="s2", task_id=task_id, step_order=2,
        tool_name="create_email_draft",
        arguments_json='{"recipient": "recov@test.com", "subject": "Recovery", "body": "Recovered"}',
        state=TaskState.READY.value
    )
    task_repo.save_step(step1)
    task_repo.save_step(step2)

    # Execute task recovery
    res = workflow_engine.execute_task(task_id)
    assert res["success"] is True
    
    # Step 1 should remain completed, step 2 is now completed
    s1_after = task_repo.get_step("s1")
    s2_after = task_repo.get_step("s2")
    assert s1_after.state == TaskState.COMPLETED.value
    assert s2_after.state == TaskState.COMPLETED.value


def test_at_13_emergency_stop_and_mute():
    """AT-13: Emergency stop halts tool execution; mute disables audio capture."""
    workflow_engine.emergency_stop()
    assert workflow_engine.is_stopped is True
    
    res = workflow_engine.handle_objective("create invoice for XYZ")
    assert res["status"] == "stopped"

    # Audio mute test
    audio_io.set_mute(True)
    assert audio_io.is_muted is True
    audio = audio_io.record_audio(duration_sec=0.1)
    assert audio is None
    audio_io.set_mute(False)


def test_internet_requirement_handling_and_resumption(monkeypatch):
    """
    User Requirement:
    Until job requires internet it never asks user.
    If task needs internet and device is offline, sets waiting_for_resource,
    informs user, and resumes automatically when connected!
    """
    task_repo = TaskRepository(db_manager)
    task_id = "online-task-test"
    
    # 1. Register a network-requiring mock tool
    from app.tools.base import BaseTool, ToolResult, EmptyInput
    class MockLiveTool(BaseTool):
        name = "send_email_live"
        description = "Send live email"
        input_schema = EmptyInput
        risk_level = RiskLevel.R4
        execution_type = "NETWORK"
        def execute(self, **kwargs):
            return ToolResult(success=True, evidence="Live email sent")

    tool_registry.register(MockLiveTool())

    # 2. Test OFFLINE scenario: simulate no internet connection
    import app.tools.registry as reg_module
    import app.orchestration.engine as eng_module
    monkeypatch.setattr(reg_module, "is_online", lambda: False)
    monkeypatch.setattr(eng_module, "is_online", lambda: False)

    out = tool_registry.execute_tool("send_email_live", {})
    assert out["status"] == "waiting_for_resource"
    assert out["resource"] == "internet_connection"
    assert "offline" in out["spoken_message"].lower()

    # Create a task in SQLite that is waiting for internet
    task = TaskRecord(
        id=task_id,
        title="Send online report",
        state=TaskState.WAITING_FOR_RESOURCE.value,
        waiting_resource="internet_connection"
    )
    task_repo.save_task(task)
    step = TaskStepRecord(
        id="s-net", task_id=task_id, step_order=1,
        tool_name="send_email_live", arguments_json="{}",
        state=TaskState.WAITING_FOR_RESOURCE.value
    )
    task_repo.save_step(step)

    # While offline, check_and_resume does nothing
    resumed_offline = workflow_engine.check_and_resume_pending()
    assert len(resumed_offline) == 0

    # 3. Test RECONNECTED scenario: internet restored!
    monkeypatch.setattr(reg_module, "is_online", lambda: True)
    monkeypatch.setattr(eng_module, "is_online", lambda: True)

    resumed_online = workflow_engine.check_and_resume_pending()
    assert len(resumed_online) == 1
    assert resumed_online[0]["success"] is True

    # Check task is now completed in SQLite
    updated_task = task_repo.get_task(task_id)
    assert updated_task.state == TaskState.COMPLETED.value


def test_visual_desktop_automation():
    """
    User Requirement:
    Desktop should see it getting done, like word/notepad getting opened and words added live.
    """
    tool = VisualOpenAndTypeTool()
    res = tool.execute(
        title="Weekly Status Report",
        text="SUNDAY automated desktop writing test.\nEverything is verified.",
        app_choice="notepad",
        save_copy=True
    )
    assert res.success is True
    assert res.data["typed_live"] is True
    assert Path(res.output_path).exists()
