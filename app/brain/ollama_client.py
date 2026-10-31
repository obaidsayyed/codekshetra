"""
Local Ollama HTTP client for SUNDAY.
Calls localhost:11434 with capped context and strict JSON formatting.
"""
import json
import subprocess
import shutil
import time
from pathlib import Path
import httpx
from typing import Dict, Any, List, Optional
from app.config.settings import settings
from app.audit.logger import audit_logger


class OllamaClient:
    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = (base_url or settings.ollama_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.num_ctx = settings.ollama_num_ctx

    def check_health(self) -> bool:
        """Verifies Ollama is running and accessible locally."""
        try:
            with httpx.Client(timeout=2.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                return res.status_code == 200
        except Exception:
            return False

    def ensure_running(self) -> bool:
        """Ensures local Ollama service is active, auto-starting if necessary."""
        if self.check_health():
            return True

        audit_logger.info("Ollama is not responding. Attempting to start local Ollama process...")
        ollama_bin = shutil.which("ollama") or r"C:\Users\omban\AppData\Local\Programs\Ollama\ollama.exe"
        if not Path(ollama_bin).exists() and not shutil.which("ollama"):
            audit_logger.error("Ollama executable not found at %s", ollama_bin)
            return False

        try:
            # Start in background with no console window
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            subprocess.Popen([ollama_bin, "serve"], creationflags=flags)
            for _ in range(10):
                time.sleep(0.5)
                if self.check_health():
                    audit_logger.info("Ollama process auto-started and ready.")
                    return True
        except Exception as e:
            audit_logger.error("Failed to auto-start Ollama: %s", e)
        return False

    def list_models(self) -> List[str]:
        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    data = res.json()
                    return [m.get("name") for m in data.get("models", [])]
        except Exception as e:
            audit_logger.warning("Failed to list Ollama models: %s", e)
        return []

    def chat_json(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.1,
        timeout: float = 15.0
    ) -> Dict[str, Any]:
        """
        Sends chat completion request enforcing JSON format and 4K context.
        Attempts primary model ('qwen2.5:3b') with fallback to 'qwen3:8b' or 'gemma2:9b'.
        """
        self.ensure_running()
        models_to_try = [self.model, "qwen2.5:3b", "qwen3:8b", "gemma2:9b"]
        seen = set()
        unique_models = [m for m in models_to_try if not (m in seen or seen.add(m))]

        last_err = None
        for m_name in unique_models:
            payload = {
                "model": m_name,
                "messages": messages,
                "stream": False,
                "format": "json",
                "options": {
                    "num_ctx": self.num_ctx,
                    "temperature": temperature
                }
            }
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.post(f"{self.base_url}/api/chat", json=payload)
                    if response.status_code == 404:
                        continue
                    response.raise_for_status()
                    data = response.json()
                    content = data.get("message", {}).get("content", "")
                    
                    parsed = json.loads(content)
                    return parsed
            except json.JSONDecodeError as jde:
                audit_logger.error("Ollama returned invalid JSON: %s\nRaw output: %s", jde, content)
                raise ValueError(f"Ollama returned malformed JSON: {str(jde)}")
            except Exception as e:
                last_err = e
                audit_logger.warning("Attempt with Ollama model '%s' failed: %s. Trying next...", m_name, e)

        if last_err:
            raise last_err
        raise RuntimeError("All Ollama models failed to respond.")


ollama_client = OllamaClient()

