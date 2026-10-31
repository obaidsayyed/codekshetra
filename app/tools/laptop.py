"""
Laptop control and system tools for SUNDAY.
Allows launching installed apps via Windows App Paths registry, opening web services,
opening folders in Windows Explorer, reading battery and hardware health, and searching personal laptop files.
"""
import subprocess
import shutil
import os
import re
import urllib.parse
import urllib.request
import winreg
import webbrowser
from pathlib import Path
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
import psutil

from app.config.settings import settings
from app.permissions.policy import RiskLevel
from app.tools.base import BaseTool, ToolResult, EmptyInput
from app.tools.files import is_path_allowed
from app.audit.logger import audit_logger


def resolve_youtube_play_url(query: str) -> tuple[str, str]:
    """
    Given a song or video title, queries YouTube to resolve the top video watch URL
    (https://www.youtube.com/watch?v=...) so it immediately autoplays in the user's browser.
    Falls back cleanly to the search results URL if offline or network unavailable.
    Returns (url_to_open, clean_title).
    """
    clean_q = re.sub(r'^(play|open|search)\s*', '', query, flags=re.IGNORECASE).strip()
    clean_q = re.sub(r'\s*(on\s+youtube|in\s+youtube|on\s+yt)\s*$', '', clean_q, flags=re.IGNORECASE).strip()
    clean_q = clean_q.rstrip(" on").strip()
    if not clean_q:
        return "https://www.youtube.com", "YouTube"

    encoded = urllib.parse.quote_plus(clean_q)
    search_url = f"https://www.youtube.com/results?search_query={encoded}"

    try:
        req = urllib.request.Request(
            search_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"
            }
        )
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
            video_ids = re.findall(r'/watch\?v=([a-zA-Z0-9_-]{11})', html)
            if video_ids:
                first_vid = video_ids[0]
                watch_url = f"https://www.youtube.com/watch?v={first_vid}"
                audit_logger.info("Resolved top YouTube video for '%s' -> %s", clean_q, watch_url)
                return watch_url, clean_q
    except Exception as e:
        audit_logger.warning("Could not resolve direct YouTube video ID (%s). Using search URL.", e)

    return search_url, clean_q


WEB_TARGETS = {
    "youtube": "https://www.youtube.com",
    "facebook": "https://www.facebook.com",
    "google": "https://www.google.com",
    "whatsapp": "https://web.whatsapp.com",
    "instagram": "https://www.instagram.com",
    "gmail": "https://mail.google.com",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "reddit": "https://www.reddit.com",
    "linkedin": "https://www.linkedin.com",
    "github": "https://github.com",
    "chatgpt": "https://chatgpt.com"
}

APP_ALIASES = {
    "google chrome": "chrome",
    "chrome browser": "chrome",
    "microsoft edge": "msedge",
    "edge browser": "msedge",
    "microsoft word": "winword",
    "ms word": "winword",
    "word": "winword",
    "microsoft excel": "excel",
    "ms excel": "excel",
    "excel": "excel",
    "microsoft powerpoint": "powerpnt",
    "powerpoint": "powerpnt",
    "ppt": "powerpnt",
    "calculator": "calc",
    "wordpad": "write",
    "paint": "mspaint",
    "file explorer": "explorer",
    "files": "explorer",
    "terminal": "wt",
    "command prompt": "cmd"
}


def get_registered_windows_apps() -> Dict[str, str]:
    """Scans Windows Registry for registered App Paths."""
    app_map = {}
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths") as key:
                count = winreg.QueryInfoKey(key)[0]
                for i in range(count):
                    try:
                        sub = winreg.EnumKey(key, i)
                        with winreg.OpenKey(key, sub) as sk:
                            val, _ = winreg.QueryValueEx(sk, "")
                            if val:
                                app_map[sub.lower()] = val.strip('"')
                                base = sub.lower().replace(".exe", "")
                                app_map[base] = val.strip('"')
                    except Exception:
                        pass
        except Exception:
            pass
    return app_map


class LaunchAppInput(BaseModel):
    app_name: str = Field(description="Name or alias of application or website (e.g. 'chrome', 'youtube', 'calc', 'word', 'notepad').")


class LaunchAppTool(BaseTool):
    name = "launch_application"
    description = "Launch a local Windows desktop application or web service on the laptop."
    input_schema = LaunchAppInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(self, app_name: str) -> ToolResult:
        raw_name = app_name.lower().strip()
        # Clean common prefixes like 'the', 'my', 'app'
        for prefix in ["open ", "launch ", "the ", "my "]:
            if raw_name.startswith(prefix):
                raw_name = raw_name[len(prefix):].strip()

        audit_logger.info("Resolving launch request for: '%s' (cleaned: '%s')", app_name, raw_name)

        # 1. Check if it's a YouTube play request (e.g. 'play believer on youtube' or 'play xyz')
        raw_l = app_name.lower().strip()
        if ("youtube" in raw_l and any(w in raw_l for w in ["play", "song", "video", "listen"])) or raw_l.startswith("play "):
            play_url, song_title = resolve_youtube_play_url(app_name)
            try:
                audit_logger.info("Playing YouTube video in browser: %s", play_url)
                webbrowser.open(play_url)
                return ToolResult(
                    success=True,
                    data={"target": play_url, "type": "youtube_play", "query": song_title},
                    evidence=f"Playing '{song_title}' on YouTube in your browser."
                )
            except Exception as e:
                return ToolResult(success=False, error=f"Could not play YouTube for '{song_title}': {str(e)}")

        # 2. Check if it's a search results URL for YouTube
        if "youtube.com/results?search_query=" in raw_name:
            m = re.search(r'search_query=([^&]+)', raw_name)
            q_extracted = urllib.parse.unquote_plus(m.group(1)) if m else ""
            play_url, song_title = resolve_youtube_play_url(q_extracted or "video")
            try:
                webbrowser.open(play_url)
                return ToolResult(
                    success=True,
                    data={"target": play_url, "type": "youtube_play", "query": song_title},
                    evidence=f"Playing '{song_title}' on YouTube in your browser."
                )
            except Exception as e:
                return ToolResult(success=False, error=f"Could not open YouTube: {str(e)}")

        # 3. Check if it's a web service / URL
        if raw_name in WEB_TARGETS or raw_name.startswith(("http://", "https://", "www.")) or raw_name.endswith((".com", ".org", ".in")):
            target_url = WEB_TARGETS.get(raw_name, raw_name)
            if not target_url.startswith(("http://", "https://")):
                target_url = "https://" + target_url
            try:
                audit_logger.info("Opening web service in browser: %s", target_url)
                webbrowser.open(target_url)
                return ToolResult(
                    success=True,
                    data={"target": target_url, "type": "web"},
                    evidence=f"Opened {raw_name.capitalize()} in your web browser."
                )
            except Exception as e:
                return ToolResult(success=False, error=f"Could not open {target_url}: {str(e)}")

        # 4. Check alias for desktop applications
        target_name = APP_ALIASES.get(raw_name, raw_name)

        # 3. Look up registered application path in Windows Registry
        reg_apps = get_registered_windows_apps()
        exe_path = reg_apps.get(target_name) or reg_apps.get(f"{target_name}.exe")

        if exe_path and Path(exe_path).exists():
            try:
                audit_logger.info("Launching registered Windows executable: %s", exe_path)
                subprocess.Popen([exe_path])
                return ToolResult(
                    success=True,
                    data={"app_name": app_name, "executable": exe_path},
                    evidence=f"Opened {app_name.capitalize()} on your laptop."
                )
            except Exception as e:
                audit_logger.warning("Direct launch of %s failed: %s. Trying os.startfile...", exe_path, e)

        # 4. Try standard Windows os.startfile / shell start
        try:
            audit_logger.info("Launching application via Windows Shell: %s", target_name)
            # cmd /c start "" <target> resolves App Paths & system binaries (notepad, calc, write, explorer)
            subprocess.Popen(f'cmd.exe /c start "" "{target_name}"', shell=True)
            return ToolResult(
                success=True,
                data={"app_name": app_name, "target": target_name},
                evidence=f"Opened {app_name.capitalize()} on your laptop."
            )
        except Exception as e:
            audit_logger.error("Failed to launch %s: %s", app_name, e)
            return ToolResult(
                success=False,
                error=f"Could not open '{app_name}' on your laptop: {str(e)}"
            )


class OpenFolderInput(BaseModel):
    folder: str = Field(default="Desktop", description="Folder name or path (e.g. 'Desktop', 'Downloads', 'Documents', 'Workspace').")


class OpenFolderTool(BaseTool):
    name = "open_folder"
    description = "Open a folder in Windows File Explorer on the desktop."
    input_schema = OpenFolderInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self, folder: str = "Desktop") -> ToolResult:
        target = Path(folder)
        if not target.is_absolute():
            user_shortcut = Path.home() / folder
            if user_shortcut.exists():
                target = user_shortcut
            else:
                target = settings.workspace_root / folder
        target = target.resolve()

        if not is_path_allowed(target):
            return ToolResult(success=False, error=f"Access denied to folder: '{target}'.")

        if not target.exists():
            return ToolResult(success=False, error=f"Folder not found: '{target}'.")

        try:
            subprocess.Popen(f'cmd.exe /c start "" "{target}"', shell=True)
            return ToolResult(
                success=True,
                output_path=str(target),
                evidence=f"Opened {target.name} in File Explorer on your desktop."
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to open File Explorer: {str(e)}")


class SystemStatusTool(BaseTool):
    name = "get_system_status"
    description = "Check laptop battery percentage, power status, CPU load, memory, and disk space."
    input_schema = EmptyInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self) -> ToolResult:
        cpu = psutil.cpu_percent(interval=0.2)
        ram = psutil.virtual_memory()
        disk = shutil.disk_usage("C:\\")

        # Battery check
        battery_text = "Unknown"
        battery = psutil.sensors_battery()
        if battery:
            status = "Plugged in" if battery.power_plugged else "On battery"
            battery_text = f"{battery.percent}% ({status})"

        summary = (
            f"Battery is at {battery_text}. "
            f"CPU is at {cpu}%. "
            f"RAM is {ram.percent}% used ({round(ram.available / (1024**3), 1)} GB free). "
            f"Disk has {round(disk.free / (1024**3), 1)} GB free space on C: drive."
        )

        return ToolResult(
            success=True,
            data={
                "battery": battery_text,
                "cpu_percent": cpu,
                "ram_percent": ram.percent,
                "disk_free_gb": round(disk.free / (1024**3), 1)
            },
            evidence=summary
        )


class SearchLaptopFilesInput(BaseModel):
    query: str = Field(description="Filename or keyword to search for.")
    location: str = Field(default="Desktop", description="Location: 'Desktop', 'Downloads', 'Documents', or 'all'.")


class SearchLaptopFilesTool(BaseTool):
    name = "search_laptop_files"
    description = "Search for files on your laptop by keyword in Desktop, Documents, or Downloads."
    input_schema = SearchLaptopFilesInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self, query: str, location: str = "Desktop") -> ToolResult:
        search_dirs = []
        home = Path.home()
        if location.lower() == "all":
            search_dirs = [home / "Desktop", home / "Documents", home / "Downloads", settings.workspace_root]
        else:
            cand = home / location
            search_dirs = [cand if cand.exists() else settings.workspace_root]

        matches = []
        q_lower = query.lower()
        for s_dir in search_dirs:
            if not s_dir.exists():
                continue
            try:
                for root, dirs, files in os.walk(str(s_dir)):
                    depth = len(Path(root).relative_to(s_dir).parts)
                    if depth > 3:
                        dirs.clear()
                        continue
                    for f in files:
                        if q_lower in f.lower():
                            full_p = Path(root) / f
                            matches.append({
                                "name": f,
                                "path": str(full_p),
                                "size_bytes": full_p.stat().st_size
                            })
                            if len(matches) >= 25:
                                break
                    if len(matches) >= 25:
                        break
            except Exception as e:
                audit_logger.warning("Search warning in %s: %s", s_dir, e)

        return ToolResult(
            success=True,
            data={"query": query, "matches": matches, "count": len(matches)},
            evidence=f"Found {len(matches)} files matching '{query}' on your laptop."
        )
