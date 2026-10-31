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
        self.is_task_executing: bool = False

    def generate_thinking_phrase(self, text: str) -> str:
        """
        Generates immediate spoken feedback while thinking/executing so SUNDAY never goes silent.
        Spoken aloud before execution begins.
        """
        tl = text.lower()
        # Direct questions or greetings respond conversationally without thinking phrase
        if any(g in tl for g in ["who are you", "what can you do", "hello", "hi sunday", "good morning", "what did i just say"]):
            return ""

        if "invoice" in tl:
            return "Preparing the invoice in Excel on your Desktop now."
        elif "spreadsheet" in tl or "excel" in tl:
            return "Creating the spreadsheet in Excel now."
        elif any(k in tl for k in ["essay", "article", "letter", "write", "notepad", "notes"]):
            return "Opening the document and drafting the text on screen."
        elif any(k in tl for k in ["youtube", "chrome", "edge", "browser"]):
            return "Opening that in your browser now."
        elif any(k in tl for k in ["calc", "calculator", "app", "application", "launch", "open"]):
            return "Opening that application on your screen."
        elif any(k in tl for k in ["battery", "hardware", "cpu", "ram", "system"]):
            return "Checking system hardware and battery status."
        elif any(k in tl for k in ["search", "find", "locate", "file"]):
            return "Searching your laptop files now."
        else:
            return "I am thinking about your request and planning the execution."

    def trigger_push_to_talk(self, on_chunk: Optional[callable] = None) -> Dict[str, Any]:
        """
        Push-to-talk handler: dynamically records speech until user finishes talking,
        transcribes with Whisper, reasons, and speaks response.
        Allows long multi-sentence natural conversations without fixed time cutoffs.
        Endpoints after 1.0s silence, or returns to standby if no speech in 1.5s.
        """
        if self.audio.is_muted or self.is_task_executing or self.engine.is_busy:
            return {"success": False, "status": "busy", "message": "SUNDAY is currently busy executing a task."}

        # 1. Listen dynamically with VAD silence endpointing
        self.state = SessionState.LISTENING
        audit_logger.info("Voice session listening dynamically for speech...")
        audio_data = self.audio.record_speech_dynamic(
            max_duration_sec=45.0,
            silence_timeout_sec=1.0,
            initial_silence_timeout_sec=1.5,
            min_duration_sec=0.8,
            energy_threshold=0.015,
            on_chunk=on_chunk
        )
        if audio_data is None or len(audio_data) == 0:
            self.state = SessionState.IDLE
            return {"success": False, "error": "No speech detected"}

        # 2. Transcribe with Whisper (beam search + noise rejection)
        self.state = SessionState.TRANSCRIBING
        transcription = self.stt.transcribe_audio(audio_data)
        text = transcription.get("text", "").strip()

        if not text:
            self.state = SessionState.IDLE
            return {
                "success": False,
                "error": "Silence or background noise rejected. Returning to standby.",
                "spoken_message": ""
            }

        audit_logger.info("User spoken utterance: '%s'", text)
        return self.process_user_utterance(text)

    def process_user_utterance(self, text: str) -> Dict[str, Any]:
        """
        Processes a recognized user command or conversational message.
        Locks execution so no further voice inputs can interrupt, speaks out thinking feedback,
        executes the task, speaks the result, and unlocks only upon completion.
        """
        text = text.strip()
        if not text:
            return {"success": False, "error": "Empty utterance"}

        # Prevent concurrent executions
        if self.is_task_executing or self.engine.is_busy:
            audit_logger.warning("Rejecting utterance '%s': SUNDAY is busy executing.", text)
            return {
                "success": False,
                "status": "busy",
                "spoken_message": "I am currently executing a task. Please wait until it completes."
            }

        audit_logger.info("Processing user utterance: '%s'", text)

        # Check for emergency stop
        if any(w in text.lower() for w in ["sunday stop", "stop execution", "cancel task", "stop"]):
            self.engine.emergency_stop()
            self.state = SessionState.IDLE
            self.is_task_executing = False
            self.tts.speak("SUNDAY stopped. All actions halted.")
            return {"success": True, "status": "stopped", "message": "Stopped by voice."}

        # Check if we were waiting for an approval
        if self.state == SessionState.WAITING_FOR_APPROVAL and self.active_approval_id:
            return self._handle_approval_response(text)

        # Lock execution: NO MORE voice inputs until this task finishes completely
        self.is_task_executing = True
        try:
            # 1. Spoken Thinking Feedback: Do not stay silent while planning/executing
            thinking_phrase = self.generate_thinking_phrase(text)
            if thinking_phrase:
                self.state = SessionState.SPEAKING
                # Microphone is automatically muted and turn-taking enforced during TTS
                self.tts.speak(thinking_phrase)

            # 2. Reason & Execute
            self.state = SessionState.THINKING
            result = self.engine.handle_objective(text)

            # 3. Handle Result / Spoken Feedback via Piper TTS
            status = result.get("status")
            if status == "conversational":
                self.state = SessionState.SPEAKING
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
                self.state = SessionState.SPEAKING
                spoken = result.get("spoken_message", "Task is waiting for network resource.")
                self.tts.speak(spoken)
                return result

            elif status == "clarification_needed":
                self.state = SessionState.SPEAKING
                spoken = result.get("spoken_message", "Please clarify.")
                self.tts.speak(spoken)
                return result

            elif status == "completed":
                self.state = SessionState.SPEAKING
                spoken = result.get("spoken_message", "Task completed.")
                self.tts.speak(spoken)
                return result

            elif status in ("busy", "duplicate"):
                return result

            else:
                self.state = SessionState.SPEAKING
                err = result.get("error", "An error occurred during execution.")
                self.tts.speak(f"Notice: {err}")
                return result

        finally:
            import time
            time.sleep(0.3)  # Cooldown so acoustic echo dissipates
            self.state = SessionState.IDLE
            self.is_task_executing = False

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

