"""
Voice session manager and conversation loop for SUNDAY.
State machine, half-duplex turn taking, voice-based approval prompts and confirmations.
"""
from enum import Enum
from typing import Optional, Dict, Any
from app.voice.audio_io import audio_io, AudioIO
from app.voice.stt import stt, SpeechToText
from app.voice.tts import tts, TextToSpeech
from app.voice.wakeword import wake_detector, WakeWordDetector
from app.orchestration.engine import workflow_engine, WorkflowEngine
from app.audit.logger import audit_logger


class SessionState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    THINKING = "thinking"
    SPEAKING = "speaking"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    MUTED = "muted"


class VoiceSession:
    def __init__(
        self,
        audio: AudioIO = audio_io,
        speech_stt: SpeechToText = stt,
        speech_tts: TextToSpeech = tts,
        engine: WorkflowEngine = workflow_engine
    ):
        self.audio = audio
        self.stt = speech_stt
        self.tts = speech_tts
        self.engine = engine
        self.state = SessionState.IDLE
        self.active_approval_id: Optional[str] = None

    def trigger_push_to_talk(self, on_chunk: Optional[callable] = None) -> Dict[str, Any]:
        """
        Push-to-talk handler: dynamically records speech until user finishes talking,
        transcribes with Whisper, reasons, and speaks response.
        Allows long multi-sentence natural conversations without fixed time cutoffs.
        """
        if self.audio.is_muted:
            return {"success": False, "status": "muted", "message": "Microphone is muted."}

        # 1. Listen dynamically with VAD silence endpointing
        self.state = SessionState.LISTENING
        audit_logger.info("Voice session listening dynamically for speech...")
        audio_data = self.audio.record_speech_dynamic(
            max_duration_sec=45.0,
            silence_timeout_sec=1.8,
            min_duration_sec=1.2,
            energy_threshold=0.004,
            on_chunk=on_chunk
        )
        if audio_data is None or len(audio_data) == 0:
            self.state = SessionState.IDLE
            return {"success": False, "error": "No speech detected"}

        # 2. Transcribe
        self.state = SessionState.TRANSCRIBING
        transcription = self.stt.transcribe_audio(audio_data)
        text = transcription.get("text", "").strip()

        if not text:
            self.state = SessionState.IDLE
            self.tts.speak("I did not hear any speech. Please speak closer to your microphone.")
            return {
                "success": False,
                "error": "Silence or very low audio signal. Check microphone level in Windows Settings.",
                "spoken_message": "I did not hear any speech. Please check your microphone."
            }

        audit_logger.info("User spoken utterance: '%s'", text)
        return self.process_user_utterance(text)

    def process_user_utterance(self, text: str) -> Dict[str, Any]:
        """
        Processes a recognized user command or conversational message.
        Handles emergency stop, approvals, LLM/deterministic execution, and speaks reply.
        """
        text = text.strip()
        audit_logger.info("Processing user utterance: '%s'", text)

        # Check for emergency stop
        if any(w in text.lower() for w in ["sunday stop", "stop execution", "cancel task", "stop"]):
            self.engine.emergency_stop()
            self.state = SessionState.IDLE
            self.tts.speak("SUNDAY stopped. All actions halted.")
            return {"success": True, "status": "stopped", "message": "Stopped by voice."}

        # Check if we were waiting for an approval
        if self.state == SessionState.WAITING_FOR_APPROVAL and self.active_approval_id:
            return self._handle_approval_response(text)

        # 3. Reason & Execute
        self.state = SessionState.THINKING
        result = self.engine.handle_objective(text)

        # 4. Handle Result / Spoken Feedback via Piper TTS
        status = result.get("status")
        if status == "conversational":
            self.state = SessionState.IDLE
            spoken = result.get("spoken_message", "I understand.")
            self.tts.speak(spoken)
            return result

        elif status == "waiting_for_owner":
            self.state = SessionState.WAITING_FOR_APPROVAL
            self.active_approval_id = result.get("approval_id")
            prompt = result.get("spoken_prompt", "Approval required.")
            self.tts.speak(prompt)
            return result

        elif status == "waiting_for_resource":
            self.state = SessionState.IDLE
            spoken = result.get("spoken_message", "Task is waiting for network resource.")
            self.tts.speak(spoken)
            return result

        elif status == "clarification_needed":
            self.state = SessionState.IDLE
            spoken = result.get("spoken_message", "Please clarify.")
            self.tts.speak(spoken)
            return result

        elif status == "completed":
            self.state = SessionState.IDLE
            spoken = result.get("spoken_message", "Task completed.")
            self.tts.speak(spoken)
            return result

        else:
            self.state = SessionState.IDLE
            err = result.get("error", "An error occurred during execution.")
            self.tts.speak(f"Notice: {err}")
            return result

    def _handle_approval_response(self, spoken_text: str) -> Dict[str, Any]:
        """Handles spoken voice response to an approval request."""
        approval_id = self.active_approval_id
        self.active_approval_id = None
        self.state = SessionState.THINKING
        
        result = self.engine.process_voice_approval(approval_id, spoken_text)
        self.state = SessionState.IDLE
        spoken = result.get("spoken_message", "Approval processed.")
        self.tts.speak(spoken)
        return result


voice_session = VoiceSession()

