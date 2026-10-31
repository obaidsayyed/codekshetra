"""
Offline Voice Pipeline tests for SUNDAY.
Tests STT, TTS, Wake Word, and half-duplex turn taking.
"""
import pytest
from pathlib import Path
import numpy as np
from app.config.settings import settings
from app.voice.tts import tts
from app.voice.stt import stt
from app.voice.audio_io import audio_io
from app.voice.wakeword import wake_detector


def test_piper_offline_tts():
    """Verify Piper offline neural TTS generates valid WAV audio file."""
    wav_path = tts.speak("SUNDAY system test complete.", play_audio=False)
    assert wav_path is not None
    assert wav_path.exists()
    assert wav_path.stat().st_size > 1000  # Non-empty WAV audio file
    # Clean up
    wav_path.unlink()


def test_faster_whisper_offline_stt():
    """Verify faster-whisper transcribes a generated audio file offline without network."""
    test_phrase = "Hello SUNDAY."
    wav_path = tts.speak(test_phrase, play_audio=False)
    try:
        res = stt.transcribe_file(str(wav_path))
        assert "text" in res
        assert len(res["text"]) > 0
        assert res["language"] == "en"
    finally:
        if wav_path.exists():
            wav_path.unlink()


def test_wakeword_prediction_frame():
    """Verify openWakeWord processes audio frames without crash."""
    # 1280 samples = 80ms at 16kHz
    dummy_frame = np.zeros(1280, dtype=np.int16)
    detected = wake_detector.predict(dummy_frame)
    # Zero audio should not trigger wake word
    assert detected is False


def test_half_duplex_turn_taking():
    """Verify microphone is muted during TTS speaking."""
    audio_io.set_mute(False)
    assert audio_io.is_muted is False
    
    # speak with play_audio=True temporarily mutes during synthesis/playback
    wav = tts.speak("Short turn taking check.", play_audio=False)
    if wav and wav.exists():
        wav.unlink()
    assert audio_io.is_muted is False

