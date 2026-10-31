"""
Offline Text-to-Speech engine for SUNDAY.
Generates local speech using Piper ONNX neural voices.
Implements half-duplex turn-taking to prevent acoustic feedback.
"""
import wave
import uuid
from pathlib import Path
from typing import Optional
import piper
from app.config.settings import settings
from app.voice.audio_io import audio_io
from app.audit.logger import audit_logger


class TextToSpeech:
    def __init__(
        self,
        model_path: Optional[Path] = None,
        config_path: Optional[Path] = None
    ):
        self.model_path = model_path or settings.tts_model_path
        self.config_path = config_path or settings.tts_config_path
        self._voice: Optional[piper.PiperVoice] = None
        self.is_speaking: bool = False

    def _get_voice(self) -> piper.PiperVoice:
        if self._voice is None:
            if not self.model_path.exists():
                raise FileNotFoundError(f"Piper model weights not found at {self.model_path}")
            audit_logger.info("Loading offline Piper TTS voice from %s...", self.model_path.name)
            self._voice = piper.PiperVoice.load(
                str(self.model_path),
                config_path=str(self.config_path) if self.config_path.exists() else None
            )
            audit_logger.info("Piper TTS voice loaded successfully.")
        return self._voice

    def speak(self, text: str, play_audio: bool = True) -> Path:
        """
        Synthesizes speech for the provided text.
        Pauses microphone listening during playback (half-duplex turn taking).
        """
        clean_text = text.strip()
        if not clean_text:
            return None

        audit_logger.info("SUNDAY speaking: '%s'", clean_text)
        temp_wav = settings.temp_dir / f"tts_{uuid.uuid4().hex[:6]}.wav"
        temp_wav.parent.mkdir(parents=True, exist_ok=True)

        voice = self._get_voice()
        with wave.open(str(temp_wav), 'wb') as wav_file:
            voice.synthesize_wav(clean_text, wav_file)

        if play_audio:
            # Turn-taking: pause mic and block incoming voice input while speaking
            self.is_speaking = True
            was_muted = audio_io.is_muted
            audio_io.set_mute(True)
            try:
                audio_io.play_wav(temp_wav)
            finally:
                # Cooldown so room acoustic reverberation completely fades before mic reopens
                import time
                time.sleep(0.35)
                audio_io.set_mute(was_muted)
                self.is_speaking = False

        return temp_wav


tts = TextToSpeech()

