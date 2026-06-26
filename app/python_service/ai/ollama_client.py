"""RFQ Flow AI - Ollama LLM Client"""
import json
import logging
import time
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen2.5:3b"
TIMEOUT_SECONDS = 120

# How long a single availability check result can be trusted before
# re-checking. This used to be a PERMANENT cache (never expired without an
# explicit reset call) — which meant that once Ollama was seen as available
# once, the system would never notice it later going down. Every subsequent
# classification attempt would then walk straight into generate()'s full
# 120s timeout, one email at a time, for as long as the queue had work —
# instead of falling into the existing graceful "wait 5 min, try again"
# path, which can only be reached when is_available() actually returns
# False. A short TTL fixes this without hammering Ollama with a request on
# every single call (is_available() gets called multiple times per email).
CACHE_TTL_SECONDS = 30

# "After some time" (per explicit request) — how long Ollama has to be
# continuously unreachable before we log a prominent warning, rather than
# warning on every single failed check (which would just be noise during a
# brief blip) or staying silent indefinitely during a real outage.
WARNING_THRESHOLD_SECONDS = 120

_cached_result: Optional[bool] = None
_cache_checked_at: float = 0.0
_consecutive_failures: int = 0
_first_failure_at: Optional[float] = None
_warning_already_logged: bool = False


def reset_availability_cache():
    """Force the next is_available() call to actually re-check, instead of
    trusting the cached result — call after changing model, or any time you
    need certainty rather than a possibly-stale cached value."""
    global _cached_result, _cache_checked_at
    _cached_result = None
    _cache_checked_at = 0.0


def get_ollama_status() -> Dict[str, Any]:
    """Current availability status, for the background worker (or a future
    Settings panel) to surface to the user — distinct from is_available()'s
    plain boolean, since this also reports how long an outage has lasted."""
    unavailable_duration = (
        time.time() - _first_failure_at if _first_failure_at is not None else None
    )
    return {
        "available": bool(_cached_result),
        "consecutive_failures": _consecutive_failures,
        "unavailable_since": _first_failure_at,
        "unavailable_duration_seconds": unavailable_duration,
        "warned": _warning_already_logged,
    }


def is_available() -> bool:
    """Check if Ollama is running locally. Cached for CACHE_TTL_SECONDS —
    NOT permanently, so a real status change (down -> up or up -> down)
    gets detected within a bounded, short window instead of never."""
    global _cached_result, _cache_checked_at, _consecutive_failures, _first_failure_at, _warning_already_logged

    now = time.time()
    if _cached_result is not None and (now - _cache_checked_at) < CACHE_TTL_SECONDS:
        return _cached_result

    try:
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/tags",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            _cached_result = resp.status == 200
            _cache_checked_at = now
            if _cached_result:
                data = json.loads(resp.read())
                models = [m.get("name", "") for m in data.get("models", [])]
                if _consecutive_failures > 0:
                    logger.info("[AI] Ollama back online after %d failed check(s).", _consecutive_failures)
                _consecutive_failures = 0
                _first_failure_at = None
                _warning_already_logged = False
                logger.info("[AI] Ollama available. Models: %s", models)
            return _cached_result
    except Exception as e:
        _cached_result = False
        _cache_checked_at = now
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = now
        outage_duration = now - _first_failure_at

        if outage_duration >= WARNING_THRESHOLD_SECONDS and not _warning_already_logged:
            logger.warning(
                "[AI] *** Ollama has been unreachable for over %d seconds (%d consecutive "
                "failed checks). Classification is paused, not stuck — it will resume "
                "automatically once Ollama is reachable again. Last error: %s ***",
                int(outage_duration), _consecutive_failures, e,
            )
            _warning_already_logged = True
        else:
            logger.debug("[AI] Ollama not available (check #%d): %s", _consecutive_failures, e)
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
