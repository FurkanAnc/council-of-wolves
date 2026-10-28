"""
API connection: provider URL, key, model and token limits.

Set from the first-run setup screen (or the legacy start.ps1 prompts) and
applied without a restart. The key is stored encrypted with Windows DPAPI in
the same format as PowerShell's ConvertFrom-SecureString, so start.ps1 and the
backend share one file; it is never sent back to the browser.
Environment variables / .env are the fallback when nothing has been saved.
"""

import json
import os
import sys
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from . import config

_cache: Dict[str, Any] = {"state": None}

ANTHROPIC_HOST = "api.anthropic.com"


# ---------------------------------------------------------------- key encryption

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    def _blob(data: bytes) -> _Blob:
        buf = ctypes.create_string_buffer(data, len(data))
        return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))

    def _take(blob: _Blob) -> bytes:
        data = ctypes.string_at(blob.pbData, blob.cbData)
        ctypes.windll.kernel32.LocalFree(blob.pbData)
        return data

    def _protect(data: bytes) -> bytes:
        out = _Blob()
        if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(_blob(data)), None, None, None, None, 0, ctypes.byref(out)):
            raise OSError("CryptProtectData failed")
        return _take(out)

    def _unprotect(data: bytes) -> bytes:
        out = _Blob()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(_blob(data)), None, None, None, None, 0, ctypes.byref(out)):
            raise OSError("CryptUnprotectData failed")
        return _take(out)

    def _encode_key(key: str) -> str:
        # Same as PowerShell ConvertFrom-SecureString: hex of DPAPI(UTF-16LE)
        return _protect(key.encode("utf-16-le")).hex()

    def _decode_key(text: str) -> str:
        return _unprotect(bytes.fromhex(text.strip())).decode("utf-16-le")

else:  # Other systems: plain text, readable by the owner only

    def _encode_key(key: str) -> str:
        return "plain:" + key

    def _decode_key(text: str) -> str:
        text = text.strip()
        if not text.startswith("plain:"):
            raise ValueError("unsupported key file")
        return text[len("plain:"):]


def _read_key() -> Optional[str]:
    try:
        with open(config.KEY_FILE, "r", encoding="utf-8-sig") as f:
            return _decode_key(f.read()) or None
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        print(f"Saved API key could not be read: {e}", flush=True)
        return None


def _write_key(key: str):
    os.makedirs(os.path.dirname(config.KEY_FILE), exist_ok=True)
    tmp = f"{config.KEY_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(_encode_key(key))
    os.replace(tmp, config.KEY_FILE)
    if sys.platform != "win32":
        os.chmod(config.KEY_FILE, 0o600)


def _read_options() -> Dict[str, Any]:
    try:
        with open(config.CONNECTION_FILE, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- state

def is_compat(base_url: Optional[str]) -> bool:
    return bool(base_url) and ANTHROPIC_HOST not in base_url


def _positive(value: Any) -> Optional[int]:
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _build(key: Optional[str], options: Dict[str, Any], source: str) -> Dict[str, Any]:
    base_url = options.get("base_url") or None
    compat = is_compat(base_url)
    return {
        "source": source,
        # Anthropic's own API takes an x-api-key; compatible providers take a Bearer token
        "api_key": key if key and not compat else None,
        "auth_token": key if key and compat else None,
        "base_url": base_url,
        "compat": compat,
        "model": options.get("model") or None,
        "max_tokens": _positive(options.get("max_tokens")) or (8192 if compat else 16000),
        "chairman_max_tokens": _positive(options.get("chairman_max_tokens")) or (8192 if compat else 32000),
    }


def _load() -> Dict[str, Any]:
    key = _read_key()
    if key:
        return _build(key, _read_options(), "saved")

    # Nothing saved: environment variables / .env (read when config was imported)
    env_key = config.ANTHROPIC_API_KEY or config.ANTHROPIC_AUTH_TOKEN
    options = {
        "base_url": config.ANTHROPIC_BASE_URL,
        "model": os.getenv("ANTHROPIC_MODEL"),
        "max_tokens": os.getenv("MAX_TOKENS"),
        "chairman_max_tokens": os.getenv("CHAIRMAN_MAX_TOKENS"),
    }
    state = _build(env_key, options, "env" if env_key else "none")
    if config.ANTHROPIC_API_KEY:  # an explicit API key always goes as x-api-key
        state.update(api_key=config.ANTHROPIC_API_KEY, auth_token=None)
    elif config.ANTHROPIC_AUTH_TOKEN:
        state.update(api_key=None, auth_token=config.ANTHROPIC_AUTH_TOKEN)
    return state


def current() -> Dict[str, Any]:
    """The connection in use (cached until saved or forgotten)."""
    if _cache["state"] is None:
        _cache["state"] = _load()
    return _cache["state"]


def reload():
    _cache["state"] = None


def has_credentials() -> bool:
    state = current()
    return bool(state["api_key"] or state["auth_token"])


def provider_label(base_url: Optional[str] = None) -> str:
    base_url = base_url if base_url is not None else current()["base_url"]
    if not base_url:
        return "Anthropic API"
    return urlparse(base_url).hostname or base_url


def title_model() -> str:
    return current()["model"] or config.TITLE_MODEL


def build_state(base_url: Optional[str], key: str, model: Optional[str],
                max_tokens: Optional[int], chairman_max_tokens: Optional[int]) -> Dict[str, Any]:
    """A candidate connection, for testing before it is saved."""
    return _build(key, {
        "base_url": base_url, "model": model,
        "max_tokens": max_tokens, "chairman_max_tokens": chairman_max_tokens,
    }, "saved")


def save(base_url: Optional[str], key: Optional[str], model: Optional[str],
         max_tokens: Optional[int], chairman_max_tokens: Optional[int]):
    """Store the connection (key encrypted) and apply it right away. key=None keeps the saved key."""
    if key:
        _write_key(key)
    os.makedirs(os.path.dirname(config.CONNECTION_FILE), exist_ok=True)
    tmp = f"{config.CONNECTION_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({
            "base_url": base_url or None,
            "model": model or None,
            "max_tokens": max_tokens,
            "chairman_max_tokens": chairman_max_tokens,
        }, f, indent=2)
    os.replace(tmp, config.CONNECTION_FILE)
    reload()


def saved_key() -> Optional[str]:
    return _read_key()


def env_key() -> Optional[str]:
    """A key from environment variables / .env, offered as a suggestion on the setup screen."""
    return config.ANTHROPIC_API_KEY or config.ANTHROPIC_AUTH_TOKEN


def _hint(key: Optional[str]) -> Optional[str]:
    return f"…{key[-4:]}" if key and len(key) > 8 else None


def forget():
    """Delete the saved key and options; environment variables apply again."""
    for path in (config.KEY_FILE, config.CONNECTION_FILE):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
    reload()


def public_info() -> Dict[str, Any]:
    """
    Safe to send to the browser: never the key itself, only its last 4 characters.

    "configured" means saved from the app; a key only found in the environment
    still shows the setup screen (pre-filled) so the user confirms it once.
    """
    state = current()
    key = state["api_key"] or state["auth_token"]
    return {
        "configured": bool(key) and state["source"] == "saved",
        "env_key_hint": _hint(env_key()) if state["source"] != "saved" else None,
        "source": state["source"],
        "base_url": state["base_url"],
        "provider": provider_label(state["base_url"]),
        "model": state["model"],
        "max_tokens": state["max_tokens"],
        "chairman_max_tokens": state["chairman_max_tokens"],
        "key_hint": _hint(key),
    }
