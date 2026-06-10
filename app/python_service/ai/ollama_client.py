"""RFQ Flow AI - Ollama LLM Client"""
import json
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.2"
TIMEOUT_SECONDS = 90

_ollama_available: Optional[bool] = None


def is_available() -> bool:
    """Check if Ollama is running locally. Cached after first check."""
    global _ollama_available
    if _ollama_available is not None:
        return _ollama_available

    try:
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/tags",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            _ollama_available = resp.status == 200
            if _ollama_available:
                data = json.loads(resp.read())
                models = [m.get("name", "") for m in data.get("models", [])]
                logger.info("[AI] Ollama available. Models: %s", models)
            return _ollama_available
    except Exception as e:
        logger.warning("[AI] Ollama not available: %s", e)
        _ollama_available = False
        return False


def generate(prompt: str, model: Optional[str] = None,
             expect_json: bool = True, temperature: float = 0.1) -> Optional[str]:
    """
    Send a prompt to Ollama and return the response text.
    Returns None if Ollama is unavailable or request fails.
    """
    if not is_available():
        return None

    m = model or DEFAULT_MODEL

    payload = {
        "model": m,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": 500,  # Limit output tokens for speed
        },
    }

    if expect_json:
        payload["format"] = "json"

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            result = json.loads(resp.read())
            response_text = result.get("response", "")
            logger.debug("[AI] Ollama response (%d chars)", len(response_text))
            return response_text

    except urllib.error.HTTPError as e:
        logger.error("[AI] Ollama HTTP %d: %s", e.code, e.read().decode()[:200])
        return None
    except Exception as e:
        logger.error("[AI] Ollama request failed: %s", e)
        return None


def generate_json(prompt: str, model: Optional[str] = None,
                  temperature: float = 0.1) -> Optional[Dict[str, Any]]:
    """Generate and parse JSON response from Ollama."""
    text = generate(prompt, model=model, expect_json=True, temperature=temperature)
    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("[AI] JSON parse failed: %s. Raw: %s", e, text[:200])
        # Try to extract JSON from markdown code blocks
        import re
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass
        return None
