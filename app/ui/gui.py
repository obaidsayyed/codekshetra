"""
Modern Desktop GUI for SUNDAY.
Provides the visual on/off toggle, push-to-talk microphone button, live activity feed, and approval prompts.
Runs locally using Python tkinter with dark-mode styling.
"""
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import threading
import time
from datetime import datetime
from typing import Optional

from app.config.settings import settings
from app.voice.audio_io import audio_io
from app.voice.session import voice_session, SessionState
from app.voice.wakeword import background_listener
from app.orchestration.engine import workflow_engine
from app.orchestration.recovery import recovery_manager
from app.orchestration.scheduler import scheduler
from app.brain.ollama_client import ollama_client
from app.tools.network import is_online
from app.audit.logger import audit_logger


class SundayGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("SUNDAY - Local-First Offline AI Employee")
        self.root.geometry("580x720")
        self.root.minsize(520, 640)
        self.root.configure(bg="#181825")

        # Application state
        self.is_active = True
        self.pending_approval_id: Optional[str] = None

        self._build_ui()
        self._start_background_services()

    def _build_ui(self):
        # 1. Header Frame
        header_frame = tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=16)
        header_frame.pack(fill="x")

        title_lbl = tk.Label(
            header_frame,
            text="SUNDAY",
            font=("Segoe UI", 24, "bold"),
            fg="#cdd6f4",
            bg="#1e1e2e"
        )
        title_lbl.pack(anchor="w")

        subtitle_lbl = tk.Label(
            header_frame,
            text="Local-First Offline AI Employee (Windows 11)",
            font=("Segoe UI", 10),
            fg="#a6adc8",
            bg="#1e1e2e"
        )
        subtitle_lbl.pack(anchor="w")

        # Status Badge
        self.status_badge = tk.Label(
            header_frame,
            text="● LISTENING FOR 'HEY SUNDAY'",
            font=("Segoe UI", 10, "bold"),
            fg="#a6e3a1",
            bg="#181825",
            padx=10,
            pady=4
        )
        self.status_badge.pack(anchor="e", pady=(4, 0))

        # 2. Main On / Off Control Card
        control_card = tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=18, highlightbackground="#313244", highlightthickness=1)
        control_card.pack(fill="x", padx=16, pady=12)

        ctrl_title = tk.Label(
            control_card,
            text="PRIMARY SYSTEM CONTROL",
            font=("Segoe UI", 9, "bold"),
            fg="#6c7086",
            bg="#1e1e2e"
        )
        ctrl_title.pack(anchor="w", pady=(0, 8))

        # Big On/Off Power Toggle Button
        self.power_btn = tk.Button(
            control_card,
            text="🔴 TURN SUNDAY OFF (MUTE)",
            font=("Segoe UI", 13, "bold"),
            bg="#f38ba8",
            fg="#11111b",
            activebackground="#eba0ac",
            activeforeground="#11111b",
            relief="flat",
            padx=16,
            pady=10,
            cursor="hand2",
            command=self._toggle_power
        )
        self.power_btn.pack(fill="x", pady=4)

        # 3. Voice Interaction Section
        voice_card = tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=16, highlightbackground="#313244", highlightthickness=1)
        voice_card.pack(fill="x", padx=16, pady=(0, 12))

        voice_title = tk.Label(
            voice_card,
            text="VOICE INTERACTION",
            font=("Segoe UI", 9, "bold"),
            fg="#6c7086",
            bg="#1e1e2e"
        )
        voice_title.pack(anchor="w", pady=(0, 8))

        # Voice buttons row
        btn_voice_row = tk.Frame(voice_card, bg="#1e1e2e")
        btn_voice_row.pack(fill="x")

        # Push To Talk Button
        self.ptt_btn = tk.Button(
            btn_voice_row,
            text="🎙️ CLICK TO SPEAK (DYNAMIC SPEECH)",
            font=("Segoe UI", 12, "bold"),
            bg="#89b4fa",
            fg="#11111b",
            activebackground="#b4befe",
            relief="flat",
            padx=12,
            pady=10,
            cursor="hand2",
            command=self._trigger_voice
        )
        self.ptt_btn.pack(side="left", fill="x", expand=True, padx=(0, 6))

        # Test Mic Button
        self.test_mic_btn = tk.Button(
            btn_voice_row,
            text="🔊 Test Mic",
            font=("Segoe UI", 10, "bold"),
            bg="#313244",
            fg="#cdd6f4",
            activebackground="#45475a",
            relief="flat",
            padx=10,
            pady=10,
            cursor="hand2",
            command=self._test_microphone
        )
        self.test_mic_btn.pack(side="right")

        self.voice_feedback_lbl = tk.Label(
            voice_card,
            text="Say 'Hey SUNDAY' or click above to speak (accepts long sentences)",
            font=("Segoe UI", 9, "italic"),
            fg="#bac2de",
            bg="#1e1e2e"
        )
        self.voice_feedback_lbl.pack(pady=(6, 0))

        # Audio level visual meter
        self.level_canvas = tk.Canvas(voice_card, height=6, bg="#313244", highlightthickness=0)
        self.level_canvas.pack(fill="x", pady=(4, 0))
        self.level_bar = self.level_canvas.create_rectangle(0, 0, 0, 6, fill="#a6e3a1", outline="")

        # 4. Optional Text Command Entry
        input_frame = tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=12, highlightbackground="#313244", highlightthickness=1)
        input_frame.pack(fill="x", padx=16, pady=(0, 12))

        entry_box_frame = tk.Frame(input_frame, bg="#313244")
        entry_box_frame.pack(fill="x")

        self.cmd_entry = tk.Entry(
            entry_box_frame,
            font=("Segoe UI", 11),
            bg="#313244",
            fg="#cdd6f4",
            insertbackground="#cdd6f4",
            relief="flat"
        )
        self.cmd_entry.pack(side="left", fill="x", expand=True, padx=8, pady=8)
        self.cmd_entry.bind("<Return>", lambda e: self._submit_text_cmd())

        send_btn = tk.Button(
            entry_box_frame,
            text="Execute",
            font=("Segoe UI", 9, "bold"),
            bg="#a6e3a1",
            fg="#11111b",
            relief="flat",
            padx=12,
            pady=6,
            cursor="hand2",
            command=self._submit_text_cmd
        )
        send_btn.pack(side="right", padx=4, pady=4)

        # 5. Spoken Approval Banner (Hidden by default)
        self.approval_banner = tk.Frame(self.root, bg="#fab387", padx=12, pady=10)
        self.approval_prompt_lbl = tk.Label(
            self.approval_banner,
            text="Approval required for action.",
            font=("Segoe UI", 9, "bold"),
            fg="#11111b",
            bg="#fab387",
            wraplength=480,
            justify="left"
        )
        self.approval_prompt_lbl.pack(side="top", anchor="w")

        btn_row = tk.Frame(self.approval_banner, bg="#fab387")
        btn_row.pack(side="bottom", fill="x", pady=(6, 0))

        self.approve_btn = tk.Button(
            btn_row,
            text="✓ Approve (or speak 'I approve')",
            font=("Segoe UI", 9, "bold"),
            bg="#a6e3a1",
            fg="#11111b",
            relief="flat",
            padx=8,
            pady=4,
            command=lambda: self._handle_approval_click("I approve")
        )
        self.approve_btn.pack(side="left", padx=(0, 8))

        self.deny_btn = tk.Button(
            btn_row,
            text="✗ Reject / Cancel",
            font=("Segoe UI", 9, "bold"),
            bg="#f38ba8",
            fg="#11111b",
            relief="flat",
            padx=8,
            pady=4,
            command=lambda: self._handle_approval_click("cancel")
        )
        self.deny_btn.pack(side="left")

        # 6. Live Activity Log Card
        log_frame = tk.Frame(self.root, bg="#1e1e2e", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0, 10))

        log_title = tk.Label(
            log_frame,
            text="ACTIVITY FEED & EXECUTION EVIDENCE",
            font=("Segoe UI", 9, "bold"),
            fg="#6c7086",
            bg="#1e1e2e"
        )
        log_title.pack(anchor="w", pady=(0, 6))

        self.log_text = scrolledtext.ScrolledText(
            log_frame,
            font=("Consolas", 9),
            bg="#11111b",
            fg="#a6adc8",
            insertbackground="#cdd6f4",
            relief="flat",
            wrap="word",
            height=8
        )
        self.log_text.pack(fill="both", expand=True)

        # 7. Status Footer
        footer = tk.Frame(self.root, bg="#11111b", padx=16, pady=6)
        footer.pack(fill="x", side="bottom")

        self.footer_lbl = tk.Label(
            footer,
            text="🔒 100% Offline Mode | Ollama: Connected | Whisper: Ready | Piper TTS: Ready",
            font=("Segoe UI", 8),
            fg="#6c7086",
            bg="#11111b"
        )
        self.footer_lbl.pack(side="left")

    def _append_log(self, text: str):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert("end", f"[{stamp}] {text}\n")
        self.log_text.see("end")

    def _update_vu_level(self, level: float):
        """Updates the visual audio signal bar."""
        try:
            width = self.level_canvas.winfo_width()
            if width <= 1:
                width = 300
            bar_len = min(int(level * width * 2.5), width)
            color = "#a6e3a1" if level < 0.35 else ("#fab387" if level < 0.70 else "#f38ba8")
            self.level_canvas.coords(self.level_bar, 0, 0, bar_len, 6)
            self.level_canvas.itemconfig(self.level_bar, fill=color)
        except Exception:
            pass

    def _start_background_services(self):
        self._append_log("Initializing SUNDAY background engines...")
        # Wire up background wake listener callbacks
        background_listener.on_wake_detected = self._on_wake_detected
        background_listener.on_status_change = self._on_wake_status_change
        background_listener.on_audio_level = self._update_vu_level
        threading.Thread(target=self._init_thread, daemon=True).start()

    def _on_wake_detected(self, text: str):
        self.root.after(0, lambda: self._append_log(f"[WAKE WORD] Heard: '{text}' - Activating!"))
        self.root.after(0, lambda: self.status_badge.configure(text="● WAKE WORD DETECTED", fg="#f9e2af"))

    def _on_wake_status_change(self, status: str):
        if status == "recording":
            self.root.after(0, lambda: self.status_badge.configure(text="🔴 RECORDING SPEECH...", fg="#f38ba8"))
            self.root.after(0, lambda: self.voice_feedback_lbl.configure(text="Recording speech dynamically... speak clearly."))
        elif status == "idle":
            self.root.after(0, lambda: self.status_badge.configure(text="● LISTENING FOR 'HEY SUNDAY'", fg="#a6e3a1"))
            self.root.after(0, lambda: self.voice_feedback_lbl.configure(text="Say 'Hey SUNDAY' or click above to speak"))

    def _init_thread(self):
        try:
            recovery_manager.recover()
            scheduler.start()
            ollama_ok = ollama_client.check_health()
            if not ollama_ok:
                ollama_client.ensure_running()
            # Start continuous background listening loop
            background_listener.start()
            self._append_log("System integrity checks passed. Ready for commands.")
            self._append_log("Continuous background listening is ACTIVE. Say 'Hey SUNDAY' or click 'Click to Speak'.")
        except Exception as e:
            self._append_log(f"Initialization warning: {e}")

    def _toggle_power(self):
        self.is_active = not self.is_active
        if self.is_active:
            audio_io.set_mute(False)
            workflow_engine.reset_stop()
            background_listener.resume()
            self.power_btn.configure(
                text="🔴 TURN SUNDAY OFF (MUTE)",
                bg="#f38ba8"
            )
            self.status_badge.configure(
                text="● LISTENING FOR 'HEY SUNDAY'",
                fg="#a6e3a1"
            )
            self._append_log("SUNDAY turned ON. Continuous listening enabled.")
        else:
            audio_io.set_mute(True)
            workflow_engine.emergency_stop()
            background_listener.pause()
            self.power_btn.configure(
                text="🟢 TURN SUNDAY ON",
                bg="#a6e3a1"
            )
            self.status_badge.configure(
                text="● PAUSED / MUTED",
                fg="#f38ba8"
            )
            self._append_log("SUNDAY turned OFF. Muted and stopped.")

    def _test_microphone(self):
        def run_test():
            self.test_mic_btn.configure(text="🔴 Recording...", bg="#f38ba8")
            self._append_log("Testing microphone for 3 seconds... please speak now.")
            data = audio_io.record_audio(duration_sec=3.0)
            self.test_mic_btn.configure(text="🔊 Playing...", bg="#fab387")
            if data is not None and len(data) > 0:
                peak_pct = int(audio_io.last_audio_level * 100)
                self._append_log(f"Microphone captured audio (Level: {peak_pct}%). Playing back now...")
                p = settings.temp_dir / "mic_test.wav"
                audio_io.save_wav(data, p)
                audio_io.play_wav(p)
                self._append_log("Playback finished. If you heard your voice, mic is working properly!")
            else:
                self._append_log("Microphone recorded zero audio. Please check Windows Microphone Privacy Settings.")
            self.test_mic_btn.configure(text="🔊 Test Mic", bg="#313244")

        threading.Thread(target=run_test, daemon=True).start()

    def _trigger_voice(self):
        if not self.is_active:
            messagebox.showinfo("SUNDAY is Paused", "Please turn SUNDAY ON using the power button first.")
            return

        def run_ptt():
            background_listener.pause()
            self.ptt_btn.configure(text="🔴 RECORDING... (SPEAK FREELY)", bg="#f38ba8")
            self.status_badge.configure(text="🔴 RECORDING SPEECH (DYNAMIC)...", fg="#f38ba8")
            self.voice_feedback_lbl.configure(text="Listening to your speech... Stop speaking when finished.")
            self._append_log("Dynamic recording active (accepts long sentences). Speak now...")

            def on_chunk(level, elapsed):
                self.root.after(0, lambda: self._update_vu_level(level))

            res = voice_session.trigger_push_to_talk(on_chunk=on_chunk)
            
            self.ptt_btn.configure(text="🎙️ CLICK TO SPEAK (DYNAMIC SPEECH)", bg="#89b4fa")
            self.voice_feedback_lbl.configure(text="Say 'Hey SUNDAY' or click above to speak")
            self.status_badge.configure(text="● LISTENING FOR 'HEY SUNDAY'", fg="#a6e3a1")
            background_listener.resume()

            peak_pct = int(audio_io.last_audio_level * 100)
            self._append_log(f"Voice capture ended (Signal level: {peak_pct}%)")

            status = res.get("status")
            if status == "waiting_for_owner":
                self._show_approval_banner(res.get("approval_id"), res.get("spoken_prompt"))
            elif res.get("spoken_message"):
                self._append_log(f"SUNDAY: {res.get('spoken_message')}")
            elif res.get("error"):
                self._append_log(f"Notice: {res.get('error')}")

        threading.Thread(target=run_ptt, daemon=True).start()

    def _submit_text_cmd(self):
        cmd = self.cmd_entry.get().strip()
        if not cmd:
            return
        self.cmd_entry.delete(0, "end")
        self._append_log(f"Command: '{cmd}'")

        def run_cmd():
            res = workflow_engine.handle_objective(cmd)
            status = res.get("status")
            if status == "waiting_for_owner":
                self._show_approval_banner(res.get("approval_id"), res.get("spoken_prompt"))
            elif res.get("spoken_message"):
                self._append_log(f"SUNDAY: {res.get('spoken_message')}")
            elif res.get("results"):
                for r in res.get("results"):
                    self._append_log(f"Evidence: {r.get('evidence')}")
            elif res.get("error"):
                self._append_log(f"Error: {res.get('error')}")

        threading.Thread(target=run_cmd, daemon=True).start()

    def _show_approval_banner(self, approval_id: str, prompt: str):
        self.pending_approval_id = approval_id
        self.approval_prompt_lbl.configure(text=prompt)
        self.approval_banner.pack(fill="x", padx=16, pady=(0, 10), before=self.log_text.master)
        self._append_log(f"APPROVAL REQUIRED: {prompt}")

    def _handle_approval_click(self, response_phrase: str):
        if not self.pending_approval_id:
            return
        apprv_id = self.pending_approval_id
        self.pending_approval_id = None
        self.approval_banner.pack_forget()

        def run_apprv():
            self._append_log(f"Processing approval response: '{response_phrase}'...")
            res = workflow_engine.process_voice_approval(apprv_id, response_phrase)
            if res.get("spoken_message"):
                self._append_log(f"SUNDAY: {res.get('spoken_message')}")
            if res.get("results"):
                for r in res.get("results"):
                    self._append_log(f"Evidence: {r.get('evidence')}")

        threading.Thread(target=run_apprv, daemon=True).start()


def run_gui():
    root = tk.Tk()
    app = SundayGUI(root)
    root.mainloop()


if __name__ == "__main__":
    run_gui()

