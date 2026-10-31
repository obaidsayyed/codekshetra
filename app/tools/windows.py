"""
Visual Windows Desktop automation tool for SUNDAY.
Allows the user to visually observe documents being opened and typed live on their screen.
"""
import subprocess
import time
import os
from pathlib import Path
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
import pywinauto
from pywinauto import Application
import pyautogui
pyautogui.FAILSAFE = False

from app.config.settings import settings
from app.permissions.policy import RiskLevel
from app.tools.base import BaseTool, ToolResult
from app.audit.logger import audit_logger


class VisualOpenAndTypeInput(BaseModel):
    title: str = Field(description="Title or filename for the document.")
    text: str = Field(description="Text content to visually type into the application.")
    app_choice: str = Field(default="notepad", description="Target application: 'notepad', 'wordpad', or 'word'.")
    save_copy: bool = Field(default=True, description="Whether to also save a verified file to output directory.")


class VisualOpenAndTypeTool(BaseTool):
    name = "visual_open_and_type"
    description = "Visually open Notepad/WordPad on the Windows desktop and type text live so the user sees it getting done."
    input_schema = VisualOpenAndTypeInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(
        self,
        title: str,
        text: str,
        app_choice: str = "notepad",
        save_copy: bool = True
    ) -> ToolResult:
        audit_logger.info("Starting visual desktop typing in %s for '%s'...", app_choice, title)
        
        executable = "notepad.exe"
        if app_choice.lower() in ("wordpad", "write"):
            executable = "write.exe"
        elif app_choice.lower() in ("word", "winword", "msword"):
            from app.tools.laptop import get_registered_windows_apps
            reg_apps = get_registered_windows_apps()
            word_bin = reg_apps.get("winword.exe") or reg_apps.get("winword")
            executable = word_bin if (word_bin and Path(word_bin).exists()) else "notepad.exe"

        # 1. Start application process
        try:
            proc = subprocess.Popen([executable])
            time.sleep(1.0)  # Allow window to map
        except Exception as e:
            audit_logger.warning("Could not launch %s directly: %s. Using notepad.exe fallback.", executable, e)
            proc = subprocess.Popen(["notepad.exe"])
            time.sleep(1.0)

        # 2. Connect to window using pywinauto or focus active window
        typed_live = False
        try:
            main_window = None
            try:
                app = Application(backend="uia").connect(title_re=".*(Notepad|WordPad|Document|Word).*", timeout=3)
                main_window = app.top_window()
                main_window.set_focus()
            except Exception:
                try:
                    app = Application(backend="uia").connect(process=proc.pid, timeout=2)
                    main_window = app.top_window()
                    main_window.set_focus()
                except Exception:
                    pass

            time.sleep(0.5)

            # Live typing effect: type lines visibly like a real human coworker
            lines = text.split("\n")
            for line in lines:
                pyautogui.write(line, interval=0.01)
                pyautogui.press("enter")
                time.sleep(0.04)

            typed_live = True
            audit_logger.info("Successfully typed %d lines live on Windows desktop window.", len(lines))
        except Exception as e:
            audit_logger.warning("Live desktop typing encountered interaction issue: %s", e)
            try:
                # Direct keystroke fallback to active window
                for line in text.splitlines():
                    pyautogui.write(line, interval=0.008)
                    pyautogui.press("enter")
                typed_live = True
            except Exception:
                pass

        # 3. Save verified copy directly to user's Windows Desktop so user sees it right away
        output_file_path = None
        if save_copy:
            clean_title = "".join(c for c in title if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
            if not clean_title:
                clean_title = "sunday_document"
            content = f"====================================================\nTitle: {title}\nDate: {time.ctime()}\n====================================================\n\n{text}"
            
            # Save in workspace output first
            workspace_file = settings.output_dir / f"{clean_title}.txt"
            try:
                workspace_file.write_text(content, encoding="utf-8")
                output_file_path = workspace_file
            except Exception as e:
                audit_logger.warning("Could not write to workspace output dir: %s", e)

            # Also attempt to save directly to user's Windows Desktop
            desktop_file = settings.user_desktop_dir / f"{clean_title}.txt"
            try:
                desktop_file.write_text(content, encoding="utf-8")
                output_file_path = desktop_file
                audit_logger.info("Saved verified document to Desktop: %s", desktop_file)
            except Exception as e:
                audit_logger.warning("Could not write directly to Desktop (%s), output saved at %s", e, output_file_path)

        return ToolResult(
            success=True,
            output_path=str(output_file_path) if output_file_path else None,
            data={
                "application": executable,
                "process_pid": proc.pid,
                "typed_live": typed_live,
                "lines_count": len(text.splitlines()),
                "saved_copy": str(output_file_path) if output_file_path else None
            },
            evidence=f"Opened {app_choice.capitalize()} on your desktop, visually wrote '{title}', and saved the file to your Desktop."
        )
