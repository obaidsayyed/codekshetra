"""
System Tray interface for SUNDAY.
Pystray icon with status indications, mute toggle, push-to-talk, and emergency stop.
"""
import threading
from typing import Optional
from PIL import Image, ImageDraw
try:
    import pystray
    from pystray import MenuItem as item
except Exception:
    pystray = None
    item = None
from app.voice.audio_io import audio_io
from app.orchestration.engine import workflow_engine
from app.voice.session import voice_session
from app.audit.logger import audit_logger


def create_tray_icon_image(color: str = "green") -> Image.Image:
    """Creates a simple colored circle icon for system tray."""
    image = Image.new('RGB', (64, 64), color=(30, 30, 30))
    d = ImageDraw.Draw(image)
    colors = {
        "green": (46, 204, 113),
        "red": (231, 76, 60),
        "yellow": (241, 196, 15),
        "blue": (52, 152, 219)
    }
    fill_col = colors.get(color, (46, 204, 113))
    d.ellipse((8, 8, 56, 56), fill=fill_col, outline=(255, 255, 255), width=2)
    return image


class TrayApp:
    def __init__(self):
        self.icon: Optional[pystray.Icon] = None
        self._thread: Optional[threading.Thread] = None

    def _toggle_mute(self, icon, item):
        new_state = not audio_io.is_muted
        audio_io.set_mute(new_state)
        icon.icon = create_tray_icon_image("red" if new_state else "green")
        icon.title = f"SUNDAY - {'MUTED' if new_state else 'ACTIVE'}"
        audit_logger.info("Tray toggled mute: %s", new_state)

    def _trigger_ptt(self, icon, item):
        threading.Thread(target=voice_session.trigger_push_to_talk, kwargs={"duration_sec": 4.0}, daemon=True).start()

    def _emergency_stop(self, icon, item):
        workflow_engine.emergency_stop()
        icon.icon = create_tray_icon_image("yellow")
        icon.title = "SUNDAY - STOPPED"

    def _on_exit(self, icon, item):
        icon.stop()

    def run(self):
        menu = pystray.Menu(
            item('Push to Talk (Voice Command)', self._trigger_ptt),
            item('Toggle Mute', self._toggle_mute),
            item('Emergency Stop', self._emergency_stop),
            item('Exit SUNDAY', self._on_exit)
        )
        self.icon = pystray.Icon(
            "SUNDAY",
            create_tray_icon_image("green"),
            "SUNDAY - Offline AI Employee",
            menu=menu
        )
        self.icon.run()

    def run_detached(self):
        self._thread = threading.Thread(target=self.run, daemon=True)
        self._thread.start()


tray_app = TrayApp()

