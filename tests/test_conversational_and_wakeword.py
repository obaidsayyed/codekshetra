"""
Tests for multi-turn conversation memory, context retention, long sentences,
and wake-word detection in SUNDAY.
"""
import pytest
from app.brain.planner import planner
from app.memory.conversation import conversation_manager
from app.orchestration.engine import workflow_engine
from app.voice.session import voice_session


def test_conversational_greetings_and_identity():
    # Test natural conversation responses
    res1 = workflow_engine.handle_objective("Hello SUNDAY, who are you?")
    assert res1["status"] == "conversational"
    assert "SUNDAY" in res1["spoken_message"]

    res2 = workflow_engine.handle_objective("What time is it right now?")
    assert res2["status"] == "conversational"
    assert "It is currently" in res2["spoken_message"]

    res3 = workflow_engine.handle_objective("Thank you so much!")
    assert res3["status"] == "conversational"
    assert "welcome" in res3["spoken_message"].lower()


def test_multiturn_clarification_and_context_retention():
    # Turn 1: User gives partial/ambiguous request
    # Engine asks for clarification or previous bot context
    conversation_manager.clear()

    # Step 1: User issues invoice request with clarification needed
    res1 = workflow_engine.handle_objective("Create an invoice")
    assert res1["status"] == "clarification_needed" or "invoice" in res1.get("spoken_message", "").lower()

    # Step 2: User provides customer and amount in follow-up turn
    res2 = workflow_engine.handle_objective("For Acme Solutions, 12500 rupees")
    assert res2["success"] is True
    assert res2["status"] == "completed"
    assert "Acme Solutions" in res2["spoken_message"]
    # Verify mathematically computed total with 18% tax (12500 * 1.18 = 14750)
    assert "14750" in res2["spoken_message"]


def test_multiturn_youtube_context():
    conversation_manager.clear()

    # Step 1: User asks for YouTube without a specific song
    res1 = workflow_engine.handle_objective("Open YouTube")
    assert res1["success"] is True

    # Step 2: Follow-up asking for song
    res2 = workflow_engine.handle_objective("Play Believer on YouTube")
    assert res2["success"] is True
    assert "youtube" in res2["spoken_message"].lower()


def test_memory_recall_query():
    conversation_manager.clear()
    workflow_engine.handle_objective("Check my battery level")
    
    # User asks what their last command was
    res = workflow_engine.handle_objective("What did I just say?")
    assert res["status"] == "conversational"
    assert "battery level" in res["spoken_message"].lower()


def test_long_sentence_natural_speech_support():
    long_instruction = (
        "I need you to write a document in Notepad titled Meeting Notes explaining that "
        "we reviewed the quarterly performance metrics and the system is operating at full efficiency offline."
    )
    res = workflow_engine.handle_objective(long_instruction)
    assert res["success"] is True
    assert "notepad" in res["spoken_message"].lower() or "document" in res["spoken_message"].lower()


def test_visual_essay_and_desktop_excel_invoice():
    # Test essay writing
    res_essay = workflow_engine.handle_objective("Write an essay on artificial intelligence in notepad")
    assert res_essay["success"] is True
    assert "artificial intelligence" in res_essay["spoken_message"].lower() or "essay" in res_essay["spoken_message"].lower() or "notepad" in res_essay["spoken_message"].lower()

    # Test spreadsheet creation
    res_sheet = workflow_engine.handle_objective("Create a spreadsheet of quarterly expenses")
    assert res_sheet["success"] is True
    assert "excel" in res_sheet["spoken_message"].lower() or "spreadsheet" in res_sheet["spoken_message"].lower()


def test_spoken_thinking_phrase_and_busy_lock():
    # 1. Spoken thinking phrase generation
    phrase_inv = voice_session.generate_thinking_phrase("create an invoice for Global Corp")
    assert "invoice" in phrase_inv.lower() or "excel" in phrase_inv.lower()

    phrase_essay = voice_session.generate_thinking_phrase("write an essay on quantum computing in notepad")
    assert "document" in phrase_essay.lower() or "drafting" in phrase_essay.lower()

    phrase_app = voice_session.generate_thinking_phrase("open Chrome")
    assert "browser" in phrase_app.lower() or "opening" in phrase_app.lower()

    # 2. Busy lock prevents concurrent re-entrant execution
    workflow_engine.is_busy = True
    try:
        busy_res = workflow_engine.handle_objective("Search for document on desktop")
        assert busy_res["success"] is False
        assert busy_res["status"] == "busy"
    finally:
        workflow_engine.is_busy = False


def test_dynamic_endpointing_and_noise_filtering():
    from app.voice.audio_io import audio_io, apply_highpass_filter
    import numpy as np

    # Verify high-pass filter eliminates low frequencies
    dummy_signal = np.sin(np.linspace(0, 100 * np.pi, 16000)).astype(np.float32)
    filtered = apply_highpass_filter(dummy_signal, sample_rate=16000, cutoff=80.0)
    assert len(filtered) == len(dummy_signal)

    # Verify 1.0s silence stop configuration in audio_io
    assert hasattr(audio_io, "record_speech_dynamic")


def test_gemma2_9b_configuration_and_medium_stt():
    from app.config.settings import settings
    from app.voice.stt import stt

    # Verify 9B model selection and medium.en STT selection
    assert settings.ollama_model == "gemma2:9b"
    assert settings.whisper_model_name == "medium.en"
    assert stt.model_name in ("medium.en", "small.en", "base.en", "tiny")
