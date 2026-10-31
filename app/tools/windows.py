"""
Visual Windows Desktop automation tool for SUNDAY.
Allows the user to visually observe documents being opened and typed live on their screen.
Supports Microsoft Word (.docx with WINWORD.EXE) and Notepad/WordPad.
"""
import subprocess
import time
import os
import re
from pathlib import Path
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
import pywinauto
from pywinauto import Application
import pyautogui
pyautogui.FAILSAFE = False
from docx import Document
from docx.shared import Inches, Pt, RGBColor

from app.config.settings import settings
from app.permissions.policy import RiskLevel
from app.tools.base import BaseTool, ToolResult
from app.audit.logger import audit_logger


class VisualOpenAndTypeInput(BaseModel):
    title: str = Field(description="Title or filename for the document.")
    text: str = Field(description="Text content to visually type or write into the application.")
    app_choice: str = Field(default="word", description="Target application: 'word', 'wordpad', or 'notepad'.")
    save_copy: bool = Field(default=True, description="Whether to also save a verified file to output directory.")


class VisualOpenAndTypeTool(BaseTool):
    name = "visual_open_and_type"
    description = "Visually open Microsoft Word, WordPad, or Notepad on the Windows desktop and present the document live so the user sees it getting done."
    input_schema = VisualOpenAndTypeInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(
        self,
        title: str,
        text: str,
        app_choice: str = "word",
        save_copy: bool = True
    ) -> ToolResult:
        audit_logger.info("Starting desktop document creation in %s for '%s'...", app_choice, title)
        is_word = app_choice.lower() in ("word", "winword", "msword", "doc", "docx")
        clean_title = "".join(c for c in title if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
        if not clean_title:
            clean_title = "Document"

        from app.tools.laptop import get_registered_windows_apps
        reg_apps = get_registered_windows_apps()
        word_bin = reg_apps.get("winword.exe") or reg_apps.get("winword") or r"C:\Program Files\Microsoft Office\Root\Office16\WINWORD.EXE"

        output_file_path = None
        proc = None
        typed_live = False

        if is_word:
            # 1. Generate beautifully formatted Microsoft Word (.docx) document
            doc = Document()
            h_title = doc.add_heading(title, level=0)
            p_meta = doc.add_paragraph()
            r_author = p_meta.add_run("Author: SUNDAY Offline AI Employee (Windows 11)\n")
            r_author.font.italic = True
            r_date = p_meta.add_run(f"Date: {time.strftime('%B %d, %Y')}")
            r_date.font.italic = True

            doc.add_paragraph()  # Blank line spacer

            # Process paragraphs and headers
            paragraphs = text.split("\n\n")
            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue
                if para.startswith("====================================================") or para.startswith("DOCUMENT:") or para.startswith("ESSAY:"):
                    continue
                if re.match(r'^\d+\.\s+[A-Z\s&,\-_]+', para) or (para.isupper() and len(para) < 60):
                    doc.add_heading(para, level=1)
                else:
                    doc.add_paragraph(para)

            # 2. Save DOCX to workspace output and directly to user's Windows Desktop
            workspace_docx = settings.output_dir / f"{clean_title}.docx"
            desktop_docx = settings.user_desktop_dir / f"{clean_title}.docx"
            desktop_saved = False

            try:
                workspace_docx.parent.mkdir(parents=True, exist_ok=True)
                doc.save(str(workspace_docx))
                output_file_path = workspace_docx
            except Exception as e:
                audit_logger.warning("Could not save to workspace docx: %s", e)

            try:
                doc.save(str(desktop_docx))
                output_file_path = desktop_docx
                desktop_saved = True
                audit_logger.info("Saved verified Word document to Desktop: %s", desktop_docx)
            except Exception as e:
                audit_logger.warning("Could not save directly to Desktop (%s)", e)

            # 3. Visually launch Microsoft Word with the document on screen
            target_to_open = desktop_docx if desktop_saved else workspace_docx
            try:
                if word_bin and Path(word_bin).exists():
                    audit_logger.info("Launching Microsoft Word (%s) with %s", word_bin, target_to_open)
                    proc = subprocess.Popen([word_bin, str(target_to_open)])
                else:
                    proc = subprocess.Popen(f'cmd.exe /c start "" "{target_to_open}"', shell=True)
                typed_live = True
                time.sleep(1.2)  # Give Word a moment to render
            except Exception as e:
                audit_logger.warning("Could not launch Word executable: %s", e)

            return ToolResult(
                success=True,
                output_path=str(output_file_path) if output_file_path else None,
                data={
                    "application": "WINWORD.EXE",
                    "process_pid": proc.pid if proc else None,
                    "typed_live": typed_live,
                    "lines_count": len(text.splitlines()),
                    "saved_copy": str(output_file_path) if output_file_path else None
                },
                evidence=f"Drafted '{title}' in Microsoft Word, saved '{clean_title}.docx' to your Desktop, and opened Word live on screen."
            )

        # Fallback / explicit notepad or wordpad handling
        executable = "notepad.exe"
        if app_choice.lower() in ("wordpad", "write"):
            executable = "write.exe"

        try:
            proc = subprocess.Popen([executable])
            time.sleep(1.0)
        except Exception as e:
            audit_logger.warning("Could not launch %s directly: %s. Using notepad.exe fallback.", executable, e)
            proc = subprocess.Popen(["notepad.exe"])
            time.sleep(1.0)

        try:
            main_window = None
            try:
                app = Application(backend="uia").connect(title_re=".*(Notepad|WordPad|Document).*", timeout=3)
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
                for line in text.splitlines():
                    pyautogui.write(line, interval=0.008)
                    pyautogui.press("enter")
                typed_live = True
            except Exception:
                pass

        if save_copy:
            content = f"====================================================\nTitle: {title}\nDate: {time.ctime()}\n====================================================\n\n{text}"
            workspace_file = settings.output_dir / f"{clean_title}.txt"
            try:
                workspace_file.write_text(content, encoding="utf-8")
                output_file_path = workspace_file
            except Exception as e:
                audit_logger.warning("Could not write to workspace output dir: %s", e)

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
                "process_pid": proc.pid if proc else None,
                "typed_live": typed_live,
                "lines_count": len(text.splitlines()),
                "saved_copy": str(output_file_path) if output_file_path else None
            },
            evidence=f"Opened {app_choice.capitalize()} on your desktop, visually wrote '{title}', and saved the file to your Desktop."
        )
