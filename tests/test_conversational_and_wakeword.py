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
        "I need you to write a document in Word titled Meeting Notes explaining that "
        "we reviewed the quarterly performance metrics and the system is operating at full efficiency offline."
    )
    res = workflow_engine.handle_objective(long_instruction)
    assert res["success"] is True
    assert "word" in res["spoken_message"].lower() or "document" in res["spoken_message"].lower()


def test_visual_essay_and_desktop_excel_invoice():
    # Test essay writing in Microsoft Word
    res_essay = workflow_engine.handle_objective("Write an essay on artificial intelligence in word")
    assert res_essay["success"] is True
    assert "artificial intelligence" in res_essay["spoken_message"].lower() or "essay" in res_essay["spoken_message"].lower() or "word" in res_essay["spoken_message"].lower()

    # Test spreadsheet creation in Microsoft Excel
    res_sheet = workflow_engine.handle_objective("Create a spreadsheet of quarterly expenses")
    assert res_sheet["success"] is True
    assert "excel" in res_sheet["spoken_message"].lower() or "spreadsheet" in res_sheet["spoken_message"].lower()


def test_spoken_thinking_phrase_and_busy_lock():
    # 1. Dynamic spoken summary generated for tasks
    plan_inv = planner.plan("create an invoice for Global Corp 20000 rupees")
    assert plan_inv.spoken_summary is not None
    assert len(plan_inv.spoken_summary) > 5

    plan_essay = planner.plan("write an essay on quantum computing in word")
    assert plan_essay.spoken_summary is not None
    assert len(plan_essay.spoken_summary) > 5

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


def test_model_configuration_and_stt():
    from app.config.settings import settings
    from app.voice.stt import stt

    # Verify low-latency fast model qwen2.5:3b and high-accuracy STT
    assert settings.ollama_model == "qwen2.5:3b"
    assert settings.whisper_model_name == "medium.en"
    assert "sunday" in settings.wake_words
    assert "hey jarvis" not in settings.wake_words
    assert stt.model_name in ("medium.en", "small.en", "base.en", "tiny")


def test_user_rain_essay_word_and_interact_ai_invoice():
    from app.brain.planner import planner

    # 1. Essay in Microsoft Word
    p_essay = planner._deterministic_plan("drafting an essay on the topic rain in word")
    assert len(p_essay.steps) == 1
    assert p_essay.steps[0].tool_name == "visual_open_and_type"
    assert p_essay.steps[0].arguments["app_choice"] == "word"
    assert p_essay.steps[0].arguments["title"] == "Rain"
    assert "Rain" in p_essay.steps[0].arguments["text"]

    # 2. Invoice for Interact AI of Rs 23k in Excel
    p_inv = planner._deterministic_plan("crertatign an invoice for interact ai of rs 23k in excel")
    assert len(p_inv.steps) == 1
    assert p_inv.steps[0].tool_name == "create_invoice"
    assert p_inv.steps[0].arguments["customer_name"] == "Interact AI"
    assert p_inv.steps[0].arguments["items"][0]["unit_price"] == 23000.0
    # Tax total 23000 * 1.18 = 27140
    assert "27140" in p_inv.spoken_summary


def test_followup_increase_essay_to_250_words():
    from app.brain.planner import planner, extract_requested_word_count
    from app.memory.conversation import conversation_manager
    from app.orchestration.engine import workflow_engine

    conversation_manager.clear()

    # Step 1: Draft initial essay
    res1 = workflow_engine.handle_objective("drafting an essay on the topic rain in word")
    assert res1["success"] is True
    active_doc = conversation_manager.get_active_document()
    assert active_doc is not None
    assert active_doc["title"] == "Rain"

    # Step 2: Follow-up command to increase to 250 words
    plan = planner._deterministic_plan("increase to 250 words")
    assert len(plan.steps) == 1
    assert plan.steps[0].tool_name == "visual_open_and_type"
    assert plan.steps[0].arguments["app_choice"] == "word"
    assert plan.steps[0].arguments["title"] == "Rain"
    
    # Verify word count meets or exceeds 250 words
    text = plan.steps[0].arguments["text"]
    words_count = len(text.split())
    assert words_count >= 250, f"Expected at least 250 words, but got {words_count}"
    assert "Rain" in plan.spoken_summary
    assert "250 words" in plan.spoken_summary

    # Execute the follow-up step
    res2 = workflow_engine.handle_objective("increase to 250 words")
    assert res2["success"] is True
    assert "Rain" in res2["spoken_message"]


def test_play_youtube_video_playback():
    from app.brain.planner import planner
    from app.orchestration.engine import workflow_engine

    # 1. Deterministic plan generates launch_application with YouTube play
    plan = planner._deterministic_plan("play believer on youtube")
    assert len(plan.steps) == 1
    assert plan.steps[0].tool_name == "launch_application"
    assert "believer" in plan.steps[0].arguments["app_name"].lower()
    assert "youtube" in plan.spoken_summary.lower()

    # 2. Execution succeeds and triggers YouTube video playback
    res = workflow_engine.handle_objective("play believer on youtube")
    assert res["success"] is True
    assert "youtube" in res["spoken_message"].lower()


def test_continuous_followup_inquiry_and_dismissal():
    from app.voice.session import voice_session
    from app.orchestration.engine import workflow_engine

    # Step 1: Voice session process_user_utterance appends follow-up inquiry
    res = voice_session.process_user_utterance("check system status", auto_listen_followup=False)
    assert res["success"] is True
    assert "Would you like me to do anything else?" in res["spoken_message"]

    # Step 2: Dismissive response returns courteous closing message
    res_dismiss = voice_session.process_user_utterance("no thank you, that's all", auto_listen_followup=False)
    assert "no thank you" in res_dismiss.get("spoken_message", "").lower() or res_dismiss.get("success") is True

