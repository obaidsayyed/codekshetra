"""
Local Speech-to-Text module for SUNDAY.
Offline inference using faster-whisper with INT8 quantization on CPU.
"""
import re
from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np
from faster_whisper import WhisperModel
from app.config.settings import settings
from app.audit.logger import audit_logger


def sanitize_transcribed_text(raw_text: str) -> str:
    """Removes bracketed Whisper artifacts and common silence hallucinations."""
    if not raw_text:
        return ""
    # Remove bracketed hallucinations like [Music], (applause), [Applause], (silence)
    cleaned = re.sub(r'\[.*?\]|\(.*?\)', '', raw_text).strip()
    hallucinations = {
        "thank you for watching", "thanks for watching", "subscribe to my channel",
        "see you next time", "thank you", "thanks", "you", "bye", "subtitles by"
    }
    if cleaned.lower() in hallucinations:
        return ""
    return cleaned


class SpeechToText:
    def __init__(self, model_dir: Optional[Path] = None, model_name: Optional[str] = None):
        self.model_dir = model_dir or settings.whisper_model_dir
        self.model_name = model_name or getattr(settings, "whisper_model_name", "base.en")
        self._model: Optional[WhisperModel] = None

    def _get_model(self) -> WhisperModel:
        if self._model is None:
            # Fallback cascade: medium.en -> small.en -> base.en -> tiny
            candidates = [self.model_name, "medium.en", "small.en", "base.en", "tiny"]
            # Deduplicate while preserving order
            seen = set()
            ordered_candidates = [c for c in candidates if not (c in seen or seen.add(c))]

            for candidate in ordered_candidates:
                try:
                    audit_logger.info("Loading offline Whisper model '%s' from %s...", candidate, self.model_dir)
                    self._model = WhisperModel(
                        candidate,
                        device="cpu",
                        compute_type="int8",
                        download_root=str(self.model_dir),
                        local_files_only=True
                    )
                    self.model_name = candidate
                    audit_logger.info("Whisper model '%s' loaded successfully.", candidate)
                    break
                except Exception as e:
                    audit_logger.warning("Could not load '%s' (%s). Trying next candidate.", candidate, e)

            if self._model is None:
                # Final fallback to tiny
                self._model = WhisperModel(
                    "tiny",
                    device="cpu",
                    compute_type="int8",
                    download_root=str(self.model_dir),
                    local_files_only=False
                )
        return self._model

    def transcribe_file(self, wav_path: str, language: Optional[str] = "en") -> Dict[str, Any]:
        """Transcribes a WAV file locally. Uses beam search and VAD to eliminate background noise."""
        target = Path(wav_path)
        if not target.exists():
            return {"text": "", "language": "en", "confidence": 0.0, "error": "Audio file not found"}

        model = self._get_model()
        lang = language if language else "en"
        prompt = (
            "SUNDAY is an offline AI employee on Windows 11. Clear English speech. "
            "Commands: create invoice in Excel, write essay in Word, spreadsheet, "
            "open YouTube, Chrome, calculator, check battery, files, search, draft message, clear history."
        )

        segments, info = model.transcribe(
            str(target),
            language=lang,
            beam_size=5,
            best_of=5,
            temperature=0,
            initial_prompt=prompt,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500, threshold=0.5, speech_pad_ms=250)
        )

        text_pieces = []
        confidences = []
        for segment in segments:
            # Filter out segments identified as non-speech noise or very low logprob
            if getattr(segment, "no_speech_prob", 0.0) > 0.45:
                continue
            if getattr(segment, "avg_logprob", 0.0) < -1.1:
                continue

            text_pieces.append(segment.text)
            if hasattr(segment, 'avg_logprob'):
                confidences.append(float(np.exp(segment.avg_logprob)))

        raw_text = " ".join(text_pieces).strip()
        full_text = sanitize_transcribed_text(raw_text)
        avg_confidence = float(np.mean(confidences)) if confidences else 1.0

        audit_logger.info("Local STT transcribed: '%s' (lang: %s, conf: %.2f)", full_text, info.language, avg_confidence)
        return {
            "text": full_text,
            "language": info.language,
            "confidence": avg_confidence
        }

    def transcribe_audio(
        self,
        audio_data: np.ndarray,
        temp_path: Optional[Path] = None,
        language: Optional[str] = "en"
    ) -> Dict[str, Any]:
        """Convenience method to transcribe raw numpy audio. Defaults to English ('en')."""
        if temp_path is None:
            temp_path = settings.temp_dir / "stt_temp.wav"
        from app.voice.audio_io import audio_io
        audio_io.save_wav(audio_data, temp_path)
        result = self.transcribe_file(str(temp_path), language=language)
        # Remove temp audio after processing (Privacy requirement)
        try:
            if temp_path.exists():
                temp_path.unlink()
        except Exception:
            pass
        return result


stt = SpeechToText()

