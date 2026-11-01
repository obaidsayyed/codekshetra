"""
Local PocketPal AI HTTP client for SUNDAY Mobile.
Communicates with the PocketPal AI local server running on Android / iOS devices.
PocketPal AI exposes an OpenAI-compatible local API on localhost:8080/v1.
Zero cloud dependencies, runs 100% offline directly on phone NPU/GPU/CPU.
"""
import json
import re
import time
from typing import Dict, Any, List, Optional
import httpx

from app.config.settings import settings
from app.audit.logger import audit_logger


class PocketPalClient:
    """
    Client for PocketPal AI mobile local server.
    Implements standard OpenAI-compatible endpoints:
    - GET /v1/models
    - POST /v1/chat/completions
    """
    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.raw_base_url = (base_url or settings.pocketpal_url).rstrip("/")
        # Ensure base URL points to /v1
        if not self.raw_base_url.endswith("/v1"):
            self.api_url = f"{self.raw_base_url}/v1"
        else:
            self.api_url = self.raw_base_url
        self.model = model or settings.pocketpal_model

    def check_health(self) -> bool:
        """Verifies PocketPal AI local server is active and reachable on the mobile device."""
        try:
            with httpx.Client(timeout=1.5) as client:
                res = client.get(f"{self.api_url}/models")
                return res.status_code == 200
        except Exception:
            try:
                with httpx.Client(timeout=1.5) as client:
                    res = client.get(f"{self.raw_base_url}/health")
                    return res.status_code == 200
            except Exception:
                return False

    def list_models(self) -> List[str]:
        """Lists local SLMs loaded inside PocketPal AI on the mobile device."""
        try:
            with httpx.Client(timeout=2.5) as client:
                res = client.get(f"{self.api_url}/models")
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                    if models:
                        return models
        except Exception as e:
            audit_logger.warning("Failed to list PocketPal AI models: %s", e)
        return [self.model]

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.1,
        max_tokens: int = 1024,
        timeout: float = 15.0
    ) -> str:
        """Sends a conversational chat completion request to PocketPal AI."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False
        }
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(f"{self.api_url}/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "").strip()
        except Exception as e:
            audit_logger.warning("PocketPal chat request error: %s", e)
            raise
        return ""

    def chat_json(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.1,
        timeout: float = 20.0
    ) -> Dict[str, Any]:
        """
        Sends structured JSON chat completion request to PocketPal AI.
        Parses and returns valid dictionary plan.
        """
        system_instruction = (
            "\n\nIMPORTANT: You must respond ONLY with a single valid, raw JSON object. "
            "Do not output markdown code blocks, explanation, or conversational commentary."
        )
        augmented_messages = list(messages)
        if augmented_messages and augmented_messages[0]["role"] == "system":
            augmented_messages[0] = {
                "role": "system",
                "content": augmented_messages[0]["content"] + system_instruction
            }
        else:
            augmented_messages.insert(0, {"role": "system", "content": system_instruction})

        payload = {
            "model": self.model,
            "messages": augmented_messages,
            "temperature": temperature,
            "max_tokens": 1024,
            "stream": False,
            "response_format": {"type": "json_object"}
        }

        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(f"{self.api_url}/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                audit_logger.debug("PocketPal AI raw response: %s", content)

                # Strip markdown code blocks if model included them
                content = re.sub(r'^```(?:json)?\s*', '', content.strip(), flags=re.MULTILINE)
                content = re.sub(r'\s*```$', '', content.strip(), flags=re.MULTILINE)

                return json.loads(content)
        except Exception as e:
            audit_logger.warning("PocketPal AI JSON completion error: %s", e)
            raise


pocketpal_client = PocketPalClient()
