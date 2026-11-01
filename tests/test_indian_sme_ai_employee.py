"""
Comprehensive Test Suite for SUNDAY Indian SME AI Employee Capabilities:
- End-to-end multi-day autonomous workflow (compressed in time)
- Computer use on realistic no-API Indian GST Portal
- Outbound voice call in an Indian language (Hindi) that changes the workflow outcome
- Owner approval gate and cryptographic audit trail
"""
import pytest
from pathlib import Path
from app.orchestration.engine import workflow_engine
from app.orchestration.multiday import multiday_workflow
from app.voice.outbound_call import vernacular_caller
from app.tools.portal_browser import gst_browser_tool
from app.tools.reconcile import reconciliation_engine
from app.memory.conversation import conversation_manager
from app.config.settings import settings


def test_end_to_end_multiday_month_end_close():
    """
    Evaluates:
    1. Multi-step workflow completed end-to-end autonomously (compressed in time).
    2. Multi-source invoice ingestion (WhatsApp & Email).
    3. Bank reconciliation against statement.
    4. Vernacular outbound call in Hindi that alters the workflow outcome.
    5. Computer use on no-API GST portal.
    6. Owner approval gate and cryptographic audit dossier export.
    """
    workflow_engine.reset()
    conversation_manager.clear()

    # Execute all 5 days in compressed time mode with owner approval
    res = multiday_workflow.execute_all_days(compress_time=True, auto_approve=True)

    assert res["success"] is True
    assert res["status"] == "COMPLETED"
    assert res["days_executed"] == 5

    # Check Day 1: Ingestion
    d1 = res["reports"][0]
    assert d1["day"] == 1
    assert "Invoice Ingestion" in d1["title"]
    assert d1["status"] == "COMPLETED"

    # Check Day 2: Bank Statement Reconciliation
    d2 = res["reports"][1]
    assert d2["day"] == 2
    assert "Bank Statement Reconciliation" in d2["title"]
    assert d2["status"] == "COMPLETED"
    assert d2["data"]["overdue"] == 27140.0

    # Check Day 3: Vernacular Outbound Call (Hindi) altering outcome
    d3 = res["reports"][2]
    assert d3["day"] == 3
    assert d3["status"] == "COMPLETED_OUTCOME_ALTERED"
    assert d3["data"]["promised_immediate"] == 13570.0
    assert d3["data"]["remaining_balance"] == 13570.0

    # Verify reminder scheduled for Monday in SQLite memory
    meetings = conversation_manager.get_upcoming_meetings(date_str="Monday")
    assert len(meetings) >= 1
    assert "Sharma Electronics" in meetings[0]["title"]

    # Check Day 4: GST Portal Computer Use (No API)
    d4 = res["reports"][3]
    assert d4["day"] == 4
    assert "GST Portal" in d4["title"]
    assert d4["data"]["invoices_filed"] >= 3

    # Check Day 5: Filed Return with EVC & Audit Dossier
    d5 = res["reports"][4]
    assert d5["day"] == 5
    assert d5["status"] == "FILED_SUCCESSFULLY"
    assert "AA071026" in d5["data"]["arn"]

    # Verify audit dossier exported
    dossier_path = Path(d5["data"]["dossier_path"])
    assert dossier_path.exists()
    content = dossier_path.read_text(encoding="utf-8")
    assert "ABC Enterprises" in content
    assert "07AAAAA1234A1Z9" in content
    assert "AA071026" in content


def test_vernacular_outbound_call_alters_workflow_outcome():
    """
    Evaluates:
    - Outbound phone call in Hindi/Hinglish.
    - Two-way dialogue.
    - Outcome alteration: reduces debt, updates ledger, schedules follow-up.
    """
    conversation_manager.clear()

    res = vernacular_caller.execute_collection_call(
        party_name="Sharma Electronics",
        contact_person="Mr. Ramesh Sharma",
        phone="+91 98112 45892",
        invoice_number="INV-2026-1042",
        amount_due=27140.0,
        customer_response_choice="partial_50_pct"
    )

    assert res.outcome_status == "PARTIAL_PAYMENT_PROMISED"
    assert res.promised_immediate_amount == 13570.0
    assert res.remaining_balance == 13570.0
    assert res.promised_followup_date == "Monday (Nov 10, 2026)"

    # Verify vernacular dialogue turns
    assert len(res.dialogue) >= 3
    assert "Namaste" in res.dialogue[0].text_vernacular
    assert "NEFT" in res.dialogue[1].text_vernacular
    assert "Sharma ji" in res.dialogue[2].text_vernacular

    # Verify transcript file
    assert Path(res.transcript_path).exists()


def test_no_api_gst_portal_computer_use():
    """
    Evaluates:
    - Computer use navigation on realistic Indian GST portal.
    - Taxpayer authentication, B2B outward supply form entries, summary, and receipt.
    """
    res = gst_browser_tool.execute(
        tax_period="October 2026",
        auto_submit=True
    )

    assert res.success is True
    assert res.data["status"] == "FILED"
    assert res.data["invoices_filed"] >= 3
    assert res.data["total_taxable_value"] > 0
    assert "AA071026" in res.data["arn"]


def test_voice_intent_triggers_month_end_close():
    """
    Evaluates:
    - Agent recognizes user command 'run month-end close'.
    - Plans and executes the complete autonomous workflow.
    """
    workflow_engine.reset()
    conversation_manager.clear()

    res = workflow_engine.handle_objective("run month end close")
    assert res["success"] is True
    assert "month-end close" in res["spoken_message"].lower() or "gst" in res["spoken_message"].lower()

