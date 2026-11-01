"""
SUNDAY Local REST & Event Bridge Server.
Runs on 127.0.0.1:8765 to connect the Python AI Engine to the Electron 3D Companion Frontend.
Provides real-time state synchronization, message handling, voice events, and tool execution.
"""
import json
import threading
import time
from typing import Dict, Any, List, Optional
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from app.config.settings import settings
from app.audit.logger import audit_logger
from app.orchestration.engine import workflow_engine
from app.voice.session import voice_session


class EventBroker:
    """Thread-safe event broker for synchronizing events to the Electron frontend."""
    def __init__(self, max_history: int = 200):
        self.lock = threading.Lock()
        self.events: List[Dict[str, Any]] = []
        self.counter: int = 0
        self.max_history = max_history

    def emit(self, event_type: str, **kwargs) -> Dict[str, Any]:
        with self.lock:
            self.counter += 1
            evt = {"id": self.counter, "type": event_type, "timestamp": time.time(), **kwargs}
            self.events.append(evt)
            if len(self.events) > self.max_history:
                self.events = self.events[-self.max_history:]
            return evt

    def get_since(self, since_id: int) -> List[Dict[str, Any]]:
        with self.lock:
            return [e for e in self.events if e["id"] > since_id]


event_broker = EventBroker()


# Hook into voice session status changes to drive 3D character animations
def _handle_voice_status_change(status: str):
    audit_logger.info("[bridge] Voice status changed: %s", status)
    if status == "listening":
        event_broker.emit("state_change", state="listening", speech="Listening...")
    elif status in ("transcribing", "thinking"):
        event_broker.emit("state_change", state="thinking", speech="Thinking...")
    elif status in ("processing", "working"):
        event_broker.emit("state_change", state="working", speech="Working on it...")
    elif status == "speaking":
        event_broker.emit("state_change", state="talking")
    elif status == "followup":
        event_broker.emit("state_change", state="listening", speech="Would you like me to do anything else?")
    elif status == "idle":
        event_broker.emit("state_change", state="idle")


voice_session.on_status_change = _handle_voice_status_change


class SundayApiHandler(BaseHTTPRequestHandler):
    server_version = "SUNDAY-Bridge/1.0"

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status_code: int, data: Dict[str, Any]):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self._send_json(200, {
                "online": True,
                "version": settings.version,
                "status": "busy" if workflow_engine.is_busy else "idle",
                "is_busy": workflow_engine.is_busy,
                "device_mode": settings.device_mode
            })
            return

        if path == "/api/events":
            params = parse_qs(parsed.query)
            since_val = int(params.get("since", ["0"])[0])
            events = event_broker.get_since(since_val)
            self._send_json(200, {"events": events})
            return

        self._send_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            body = {}

        if path == "/api/message":
            text = body.get("text", "").strip()
            if not text:
                self._send_json(400, {"success": False, "error": "Empty message text"})
                return

            audit_logger.info("[bridge] Processing user objective from companion: '%s'", text)

            # 1. Update character state: thinking
            event_broker.emit("state_change", state="thinking", speech="Thinking...")

            # 2. Execute objective through workflow engine
            def _set_working():
                time.sleep(0.5)
                if workflow_engine.is_busy:
                    event_broker.emit("state_change", state="working", speech="Working on it...")

            threading.Thread(target=_set_working, daemon=True).start()

            result = workflow_engine.handle_objective(text)

            # 3. Synchronize completion to character
            if result.get("success"):
                spoken = result.get("spoken_message", "Task completed.")
                event_broker.emit("state_change", state="celebrating", speech=spoken)
                event_broker.emit("chat_message", role="sunday", text=spoken)
            elif result.get("status") == "waiting_for_owner":
                prompt = result.get("spoken_prompt", "Approval required.")
                event_broker.emit("state_change", state="thinking", speech=prompt)
                event_broker.emit("chat_message", role="system", text=prompt)
            else:
                err_msg = result.get("spoken_message") or result.get("error") or "Execution failed."
                event_broker.emit("state_change", state="error", speech=err_msg)
                event_broker.emit("chat_message", role="system", text=err_msg)

            self._send_json(200, result)
            return

        if path == "/api/voice/listen":
            # Trigger voice recording
            def _run_voice():
                event_broker.emit("state_change", state="listening", speech="Listening...")
                voice_session.process_user_utterance(
                    text="", # Will record
                    auto_listen_followup=True
                )
            threading.Thread(target=_run_voice, daemon=True).start()
            self._send_json(200, {"success": True, "message": "Voice listening triggered"})
            return

        if path == "/api/stop":
            msg = workflow_engine.emergency_stop()
            event_broker.emit("state_change", state="error", speech="Stopped.")
            self._send_json(200, {"success": True, "message": msg})
            return

        if path == "/api/approval":
            apprv_id = body.get("approval_id")
            spoken_resp = body.get("response", "yes")
            if not apprv_id:
                self._send_json(400, {"error": "Missing approval_id"})
                return
            res = workflow_engine.process_voice_approval(apprv_id, spoken_resp)
            self._send_json(200, res)
            return

        self._send_json(404, {"error": "Endpoint not found"})

    def log_message(self, format, *args):
        # Silence routine HTTP polling logs to avoid console spam
        if args and any(p in str(args[0]) for p in ["/api/events", "/api/status"]):
            return
        audit_logger.debug("[server] " + (format % args))


_server_instance: Optional[ThreadingHTTPServer] = None
_server_lock = threading.Lock()


def start_server_in_background(host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    """Starts the SUNDAY local bridge server in a background daemon thread."""
    global _server_instance
    with _server_lock:
        if _server_instance is not None:
            return _server_instance

        server = ThreadingHTTPServer((host, port), SundayApiHandler)
        _server_instance = server

        def _serve():
            audit_logger.info("SUNDAY Bridge Server listening at http://%s:%d", host, port)
            try:
                server.serve_forever()
            except Exception as e:
                audit_logger.warning("Bridge server stopped: %s", e)

        thread = threading.Thread(target=_serve, daemon=True, name="SundayBridgeServer")
        thread.start()
        time.sleep(0.2)  # Give socket a moment to bind
        return server

