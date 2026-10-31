"""
Network detection and offline resource management for SUNDAY.
Handles internet requirement detection, offline suspension, and automatic resumption upon reconnection.
"""
import socket
from typing import Dict, Any, Optional
from app.audit.logger import audit_logger


def is_online(timeout: float = 1.0) -> bool:
    """
    Checks if active internet connection is available.
    Probes reliable DNS IP (8.8.8.8 or 1.1.1.1) on port 53 without HTTP overhead.
    """
    for host in ("8.8.8.8", "1.1.1.1"):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((host, 53))
            sock.close()
            return True
        except Exception:
            continue
    return False


NETWORK_REQUIRED_TOOLS = {
    "send_email_live",
    "search_web",
    "fetch_url",
    "download_remote_file",
    "cloud_sync"
}


def requires_internet(tool_name: str, arguments: Dict[str, Any] = None) -> bool:
    """Returns True if the tool strictly requires internet access."""
    if tool_name in NETWORK_REQUIRED_TOOLS:
        return True
    return False

