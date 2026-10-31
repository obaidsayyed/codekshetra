"""
Wake-word detection and continuous background listening module for SUNDAY.
Uses openWakeWord locally for instant wake detection and continuous VAD speech monitoring.
"""
import threading
import time
import re
from typing import Optional, List, Callable
import numpy as np
import scipy.signal
import sounddevice as sd
from openwakeword.model import Model
from app.config.settings import settings
from app.audit.logger import audit_logger


class WakeWordDetector:
    def __init__(self, threshold: Optional[float] = None):
        self.threshold = threshold or settings.wake_threshold
        self._model: Optional[Model] = None

    def _get_model(self) -> Model:
        if self._model is None:
            audit_logger.info("Initializing openWakeWord models...")
            # Load bundled hey_jarvis model (used as the base offline detector)
            self._model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
            audit_logger.info("Wake-word model initialized.")
        return self._model

    def predict(self, audio_frame: np.ndarray) -> bool:
        """
        Processes 1280 samples (80 ms at 16kHz) of audio.
        Returns True if wake phrase detected above threshold.
        """
        try:
            model = self._get_model()
            predictions = model.predict(audio_frame)
            for wakeword_name, score in predictions.items():
                if score >= self.threshold:
                    audit_logger.info("Wake word detected! Model: %s, Score: %.3f", wakeword_name, score)
                    return True
        except Exception as e:
            audit_logger.warning("Wake-word prediction exception: %s", e)
        return False


wake_detector = WakeWordDetector()


class BackgroundVoiceListener:
    """
    Continuous background listening thread for SUNDAY.
    Monitors microphone input continuously for wake words ('Hey SUNDAY' or 'Hey Jarvis').
    Operates in half-duplex mode: automatically pauses when SUNDAY speaks or records.
    """
    def __init__(
        self,
        detector: WakeWordDetector = wake_detector,
        on_wake_detected: Optional[Callable[[str], None]] = None,
        on_status_change: Optional[Callable[[str], None]] = None,
        on_audio_level: Optional[Callable[[float], None]] = None
    ):
        self.detector = detector
        self.on_wake_detected = on_wake_detected
        self.on_status_change = on_status_change
        self.on_audio_level = on_audio_level
        self.is_running = False
        self.is_paused = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.is_paused = False
        self._thread = threading.Thread(target=self._listen_loop, daemon=True, name="SundayWakeListener")
        self._thread.start()
        audit_logger.info("Continuous background wake-word listener started.")

    def stop(self):
        self.is_running = False
        self.is_paused = True

    def pause(self):
        self.is_paused = True

    def resume(self):
        self.is_paused = False

    def _listen_loop(self):
        from app.voice.audio_io import audio_io
        from app.voice.tts import tts
        from app.voice.stt import stt
        from app.voice.session import voice_session, SessionState

        native_rate = audio_io.get_device_native_rate()
        chunk_duration = 0.15  # 150ms per chunk
        chunk_samples = int(chunk_duration * native_rate)

        speech_buffer = []
        silence_after_speech_sec = 0.0
        speech_active = False

        while self.is_running:
            from app.orchestration.engine import workflow_engine

            if self.is_paused or audio_io.is_muted or audio_io.is_recording:
                time.sleep(0.1)
                continue

            if tts.is_speaking or voice_session.state != SessionState.IDLE or voice_session.is_task_executing or workflow_engine.is_busy:
                time.sleep(0.15)
                continue

            try:
                with sd.InputStream(
                    samplerate=native_rate,
                    channels=audio_io.channels,
                    dtype='float32',
                    blocksize=chunk_samples
                ) as stream:
                    audit_logger.info("Microphone stream opened for background wake detection.")
                    while self.is_running and not self.is_paused and not audio_io.is_muted and not audio_io.is_recording:
                        if tts.is_speaking or voice_session.state != SessionState.IDLE or voice_session.is_task_executing or workflow_engine.is_busy:
                            time.sleep(0.15)
                            break

                        data, _ = stream.read(chunk_samples)
                        chunk = data.flatten()
                        peak = float(np.max(np.abs(chunk)))
                        rms = float(np.sqrt(np.mean(chunk ** 2)))

                        if self.on_audio_level:
                            self.on_audio_level(peak)

                        # Resample chunk to 16 kHz
                        if native_rate != 16000:
                            num_16k = int(len(chunk) * 16000 / native_rate)
                            chunk_16k = scipy.signal.resample(chunk, num_16k)
                        else:
                            chunk_16k = chunk

                        chunk_int16 = (np.clip(chunk_16k, -1.0, 1.0) * 32767.0).astype(np.int16)

                        # Continuous Speech Buffer & VAD strictly for 'Sunday' / 'Hey Sunday'
                        # Reject ambient noise floor (< 0.008)
                        if rms >= 0.008:
                            speech_active = True
                            silence_after_speech_sec = 0.0
                            speech_buffer.append(chunk_int16)
                            # Keep buffer to max ~4 seconds
                            if len(speech_buffer) > 28:
                                speech_buffer.pop(0)
                        else:
                            if speech_active:
                                silence_after_speech_sec += chunk_duration
                                speech_buffer.append(chunk_int16)

                                # Speech pause / endpoint reached (0.6s)
                                if silence_after_speech_sec >= 0.6:
                                    speech_active = False
                                    silence_after_speech_sec = 0.0

                                    if speech_buffer:
                                        full_buf = np.concatenate(speech_buffer)
                                        speech_buffer.clear()

                                        # Only transcribe if audio is >= 0.6 seconds
                                        if len(full_buf) >= 9600:
                                            res = stt.transcribe_audio(full_buf)
                                            txt = res.get("text", "").strip()
                                            txt_lower = txt.lower()

                                            # Strict Sunday wake words only
                                            wake_triggers = [
                                                "sunday", "hey sunday", "hi sunday",
                                                "hello sunday", "ok sunday"
                                            ]
                                            if any(w in txt_lower for w in wake_triggers):
                                                audit_logger.info("Spoken wake detected: '%s'", txt)
                                                self._handle_wake(txt)
                                                break

            except Exception as e:
                audit_logger.warning("Background voice listener stream exception: %s", e)
                time.sleep(0.5)

    def _handle_wake(self, detected_text: str):
        """Processes wake word trigger and transitions seamlessly to command handling."""
        audit_logger.info("Wake word activated with utterance: '%s'", detected_text)
        from app.voice.session import voice_session
        from app.voice.tts import tts
        from app.orchestration.engine import workflow_engine

        # Immediately pause listener to prevent re-triggering during execution
        self.pause()

        if self.on_wake_detected:
            self.on_wake_detected(detected_text)

        # Reject if already executing
        if voice_session.is_task_executing or workflow_engine.is_busy:
            audit_logger.warning("Wake word ignored: task execution currently in progress.")
            self.resume()
            return

        # Extract possible inline command after the wake word (e.g. 'Hey Sunday open YouTube')
        cmd = re.sub(r'^(hey|hi|hello|ok|okay)?\s*(sunday)[,\s]*', '', detected_text, flags=re.IGNORECASE).strip()
        cmd = cmd.lstrip(".,!? ").strip()

        if cmd and len(cmd) > 2:
            audit_logger.info("Executing inline command following wake word: '%s'", cmd)
            def run_inline():
                try:
                    voice_session.process_user_utterance(cmd, auto_listen_followup=True)
                finally:
                    self.resume()
            threading.Thread(target=run_inline, daemon=True).start()
        else:
            def run_wake_prompt():
                try:
                    tts.speak("Yes? I am listening.")
                    if self.on_status_change:
                        self.on_status_change("recording")
                    voice_session.trigger_push_to_talk()
                finally:
                    if self.on_status_change:
                        self.on_status_change("idle")
                    self.resume()
            threading.Thread(target=run_wake_prompt, daemon=True).start()


background_listener = BackgroundVoiceListener()

