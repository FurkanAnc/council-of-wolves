"""Anthropic API client for making Claude requests."""

import asyncio
import time
from typing import List, Dict, Any, Optional

import anthropic

from .config import (
    ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, COMPAT_MODE,
    HAS_CREDENTIALS, MAX_TOKENS, REQUEST_TIMEOUT,
)

# Server-side refusal fallback: if a safety classifier declines a request,
# the API reroutes it to a suitable fallback model instead of failing.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

_client: Optional[anthropic.AsyncAnthropic] = None

# Most recent API error, surfaced to the UI when every member fails
last_error: Optional[str] = None


def _fail(message: str) -> None:
    global last_error
    last_error = message
    print(message, flush=True)


def get_client() -> anthropic.AsyncAnthropic:
    """Create the shared async client on first use."""
    global _client
    if _client is None:
        if not HAS_CREDENTIALS:
            raise RuntimeError(
                "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is not set. "
                "Add it to the .env file in the project root."
            )
        _client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            auth_token=None if ANTHROPIC_API_KEY else ANTHROPIC_AUTH_TOKEN,
            base_url=ANTHROPIC_BASE_URL,
            max_retries=3,
        )
    return _client


def build_params(
    model: str,
    messages: List[Dict[str, str]],
    system: Optional[str],
    max_tokens: int,
    effort: Optional[str],
) -> Dict[str, Any]:
    """Request parameters; Anthropic-only features are skipped in compat mode."""
    params: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        params["system"] = system
    if not COMPAT_MODE:
        params["betas"] = [FALLBACK_BETA]
        params["fallbacks"] = "default"
        if effort:
            params["output_config"] = {"effort": effort}
    return params


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    system: Optional[str] = None,
    max_tokens: int = MAX_TOKENS,
    timeout: float = REQUEST_TIMEOUT,
    effort: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Query a single Claude model.

    Args:
        model: Claude model ID (e.g., "claude-opus-5-5")
        messages: List of message dicts with 'role' and 'content'
        system: Optional system prompt
        max_tokens: Maximum output tokens (thinking included)
        timeout: Request timeout in seconds
        effort: Optional effort level ("low" ... "max")

    Returns:
        Response dict with 'content', 'usage' and 'truncated', or None if failed
    """
    params = build_params(model, messages, system, max_tokens, effort)

    try:
        client = get_client().with_options(timeout=timeout)
        # Compat providers get the plain endpoint (no anthropic-beta header)
        messages_api = client.messages if COMPAT_MODE else client.beta.messages
        # Stream to avoid HTTP timeouts on long generations
        async with messages_api.stream(**params) as stream:
            response = await stream.get_final_message()

        if response.stop_reason == "refusal":
            _fail(f"Model {model} declined the request: {getattr(response, 'stop_details', None)}")
            return None
        truncated = response.stop_reason == "max_tokens"
        text = "".join(block.text for block in response.content if block.type == "text").strip()

        if not text:
            # Typically the whole budget went to reasoning before any answer text
            reason = f" (max_tokens={max_tokens} reached)" if truncated else ""
            _fail(f"Model {model} returned an empty answer{reason}")
            return None
        if truncated:
            print(f"Warning: model {model} hit max_tokens ({max_tokens}); output truncated", flush=True)

        usage = getattr(response, "usage", None)
        return {
            "content": text,
            "truncated": truncated,
            "usage": {
                "input_tokens": getattr(usage, "input_tokens", 0) or 0,
                "output_tokens": getattr(usage, "output_tokens", 0) or 0,
            },
        }

    except anthropic.APIStatusError as e:
        _fail(f"Error querying model {model}: HTTP {e.status_code}: {e.message}")
        return None
    except anthropic.APIConnectionError as e:
        _fail(f"Connection error querying model {model}: {e}")
        return None
    except Exception as e:
        _fail(f"Error querying model {model}: {type(e).__name__}: {e}")
        return None


async def query_members_parallel(
    members: List[Dict[str, Any]],
    messages: List[Dict[str, str]],
    use_system_prompt: bool = True,
    system: Optional[str] = None,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple council members in parallel.

    Args:
        members: Council member dicts (id, name, model, system_prompt)
        messages: List of message dicts to send to each member
        use_system_prompt: Send each member's own role prompt
        system: Shared system prompt used when use_system_prompt is False

    Returns:
        Dict mapping MEMBER ID (not model) to response dict (or None if failed)
    """
    tasks = [
        query_model(
            member["model"],
            messages,
            system=member.get("system_prompt") if use_system_prompt else system,
        )
        for member in members
    ]
    responses = await asyncio.gather(*tasks)
    return {member["id"]: response for member, response in zip(members, responses)}


async def check_connection(probe_model: str) -> Dict[str, Any]:
    """
    Verify that the API is reachable and the key is accepted.

    Lists models first (free); providers without that endpoint get a
    1-token request to `probe_model` instead.

    Returns:
        Dict with 'status' (connected | no_key | auth_error | unreachable | error),
        'message' and, when connected, 'latency_ms'
    """
    if not HAS_CREDENTIALS:
        return {"status": "no_key", "message": "API anahtarı tanımlı değil."}

    client = get_client().with_options(timeout=15.0, max_retries=0)
    started = time.monotonic()
    try:
        try:
            await client.models.list(limit=1)
        except (anthropic.NotFoundError, anthropic.UnprocessableEntityError):
            await client.messages.create(
                model=probe_model,
                max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
        return {
            "status": "connected",
            "message": "API bağlı.",
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        return {"status": "auth_error", "message": f"Anahtar kabul edilmedi (HTTP {e.status_code}): {e.message}"}
    except anthropic.APIConnectionError as e:
        return {"status": "unreachable", "message": f"API sunucusuna ulaşılamadı: {e}"}
    except anthropic.APIStatusError as e:
        return {"status": "error", "message": f"API hata döndü (HTTP {e.status_code}): {e.message}"}
    except Exception as e:
        return {"status": "error", "message": f"{type(e).__name__}: {e}"}
