"""
Voice session manager and conversation loop for SUNDAY.
State machine, half-duplex turn taking, voice-based approval prompts and confirmations.
"""
from enum import Enum
import re
from typing import Optional, Dict, Any, Callable
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
        engine: WorkflowEngine = workflow_engine,
        on_status_change: Optional[Callable[[str], None]] = None
    ):
        self.audio = audio
        self.stt = speech_stt
        self.tts = speech_tts
        self.engine = engine
        self.on_status_change = on_status_change
        self._state = SessionState.IDLE
        self.active_approval_id: Optional[str] = None
        self.is_task_executing: bool = False

    @property
    def state(self) -> SessionState:
        return self._state

    @state.setter
    def state(self, new_state: SessionState) -> None:
        self._state = new_state
        if self.on_status_change:
            try:
                val = new_state.value if isinstance(new_state, SessionState) else str(new_state)
                self.on_status_change(val)
            except Exception as e:
                audit_logger.warning("Error in on_status_change: %s", e)

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
            max_duration_sec=60.0,
            silence_timeout_sec=1.2,
            initial_silence_timeout_sec=5.0,
            min_duration_sec=0.6,
            energy_threshold=0.008,
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
        return self.process_user_utterance(text, auto_listen_followup=True, on_chunk=on_chunk)

    def process_user_utterance(
        self,
        text: str,
        auto_listen_followup: bool = False,
        on_chunk: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Processes a recognized user command or conversational message.
        Locks execution so no further voice inputs can interrupt, speaks out thinking feedback,
        executes the task, speaks the result, and optionally listens for follow-up continuation.
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

        # Check for dismissive phrases (e.g., "no that's it", "thank you", "that's it", "no thanks")
        dismissive = [
            "no", "nothing", "that's all", "thats all", "that's it", "thats it",
            "no that's it", "no thats it", "no that is it", "thank you", "thanks",
            "no thank you", "no thanks", "nope", "i am good", "im good", "all good",
            "nothing else", "no more", "ok thats it", "okay thats it", "ok that's it", "okay that's it",
            "all done", "we are done", "we're done"
        ]
        clean_text = re.sub(r'[^\w\s]', '', text.lower()).strip()
        for prefix in ["sunday", "hey sunday", "hi sunday", "ok sunday", "okay sunday", "hello sunday"]:
            if clean_text.startswith(prefix):
                clean_text = clean_text[len(prefix):].strip()

        if clean_text in dismissive or any(clean_text == d for d in dismissive):
            self.state = SessionState.SPEAKING
            closing = "Alright, let me know if you need anything else."
            self.tts.speak(closing)
            self.state = SessionState.IDLE
            self.is_task_executing = False
            try:
                from app.server.api_server import event_broker
                event_broker.emit("character_visibility", visible=False)
            except Exception:
                pass
            if self.on_status_change:
                self.on_status_change("idle")
            return {"success": True, "status": "conversational", "spoken_message": closing}

        # Check if we were waiting for an approval
        if self.state == SessionState.WAITING_FOR_APPROVAL and self.active_approval_id:
            return self._handle_approval_response(text)

        # Lock execution: NO MORE voice inputs until this task finishes completely
        self.is_task_executing = True
        try:
            # 1. Reason & Execute task with Ollama spoken summary and tool execution
            self.state = SessionState.THINKING
            result = self.engine.handle_objective(text)

            # 2. Handle Result / Spoken Feedback via Piper TTS
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

                # Clarification Turn: Keep microphone open for user's answer
                if auto_listen_followup:
                    audit_logger.info("Clarification requested. Listening for user's answer...")
                    self.state = SessionState.LISTENING
                    self.is_task_executing = False
                    if self.on_status_change:
                        self.on_status_change("listening")

                    clarif_audio = self.audio.record_speech_dynamic(
                        max_duration_sec=30.0,
                        silence_timeout_sec=1.2,
                        initial_silence_timeout_sec=5.0,
                        min_duration_sec=0.5,
                        energy_threshold=0.008,
                        on_chunk=on_chunk
                    )

                    if clarif_audio is not None and len(clarif_audio) > 0:
                        self.state = SessionState.TRANSCRIBING
                        transcription = self.stt.transcribe_audio(clarif_audio)
                        answer_text = transcription.get("text", "").strip()

                        if answer_text:
                            audit_logger.info("User answered clarification with: '%s'", answer_text)
                            return self.process_user_utterance(
                                answer_text,
                                auto_listen_followup=True,
                                on_chunk=on_chunk
                            )

                    audit_logger.info("No clarification speech detected within timeout. Returning to standby.")
                    self.state = SessionState.IDLE
                    if self.on_status_change:
                        self.on_status_change("idle")

                return result

            elif status == "completed":
                self.state = SessionState.SPEAKING
                spoken = result.get("spoken_message", "Task completed.")

                # Append follow-up prompt so conversation continues naturally
                if not any(f in spoken.lower() for f in ["anything else", "what else", "need anything"]):
                    spoken = f"{spoken} Would you like me to do anything else?"
                result["spoken_message"] = spoken
                self.tts.speak(spoken)

                # Continuous Voice Follow-up Turn: Keep microphone open for user's reply
                if auto_listen_followup:
                    audit_logger.info("Task completed. Listening for follow-up response from user...")
                    self.state = SessionState.LISTENING
                    self.is_task_executing = False
                    if self.on_status_change:
                        self.on_status_change("followup")

                    followup_audio = self.audio.record_speech_dynamic(
                        max_duration_sec=30.0,
                        silence_timeout_sec=1.2,
                        initial_silence_timeout_sec=4.5,
                        min_duration_sec=0.5,
                        energy_threshold=0.008,
                        on_chunk=on_chunk
                    )

                    if followup_audio is not None and len(followup_audio) > 0:
                        self.state = SessionState.TRANSCRIBING
                        transcription = self.stt.transcribe_audio(followup_audio)
                        followup_text = transcription.get("text", "").strip()

                        if followup_text:
                            audit_logger.info("Follow-up user utterance: '%s'", followup_text)
                            dismissive = [
                                "no", "nothing", "that's all", "thats all", "that's it", "thats it",
                                "no that's it", "no thats it", "no that is it", "thank you", "thanks",
                                "no thank you", "no thanks", "nope", "i am good", "im good", "all good",
                                "stop", "cancel", "done", "bye", "goodbye", "nothing else", "no more",
                                "ok thats it", "okay thats it", "ok that's it", "okay that's it",
                                "all done", "we are done", "we're done"
                            ]
                            clean_ans = re.sub(r'[^\w\s]', '', followup_text.lower()).strip()
                            is_dismiss = clean_ans in dismissive or any(
                                clean_ans == d or clean_ans.startswith(d) or clean_ans.endswith(d)
                                for d in dismissive
                            )
                            if is_dismiss:
                                self.state = SessionState.SPEAKING
                                closing = "Alright, let me know if you need anything else."
                                self.tts.speak(closing)
                                self.state = SessionState.IDLE
                                try:
                                    from app.server.api_server import event_broker
                                    event_broker.emit("character_visibility", visible=False)
                                except Exception:
                                    pass
                                if self.on_status_change:
                                    self.on_status_change("idle")
                                return {**result, "closing_message": closing}
                            else:
                                if self.on_status_change:
                                    self.on_status_change("processing")
                                return self.process_user_utterance(
                                    followup_text,
                                    auto_listen_followup=True,
                                    on_chunk=on_chunk
                                )

                    audit_logger.info("No follow-up speech detected within timeout. Returning to standby.")
                    self.state = SessionState.IDLE
                    if self.on_status_change:
                        self.on_status_change("idle")

                return result

            elif status in ("busy", "duplicate"):
                return result

            else:
                self.state = SessionState.SPEAKING
                spoken_msg = result.get("spoken_message")
                if not spoken_msg:
                    raw_err = result.get("error", "An error occurred during execution.")
                    from app.brain.planner import format_error_for_speech
                    spoken_msg = format_error_for_speech(raw_err)
                self.tts.speak(spoken_msg)
                return result

        except Exception as ex:
            self.state = SessionState.SPEAKING
            audit_logger.error("Exception in process_user_utterance: %s", ex, exc_info=True)
            from app.brain.planner import format_error_for_speech
            clean_spoken_err = format_error_for_speech(str(ex))
            self.tts.speak(clean_spoken_err)
            return {"success": False, "status": "failed", "error": str(ex), "spoken_message": clean_spoken_err}

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

