"""FastAPI backend for Claude Council."""

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import time
import asyncio
from datetime import datetime, timezone

from . import storage, anthropic_client, connection, settings as council_settings
from .config import HOST, PORT
from .council import (
    build_history, run_full_council, generate_conversation_title, stage1_collect_responses,
    run_debate, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings,
    failed_members, total_usage, estimated_calls,
)

app = FastAPI(title="Claude Council API")

MISSING_KEY_MESSAGE = "API anahtarı tanımlı değil. Uygulamadaki kurulum ekranından ekleyin."


def require_api_key():
    """Fail fast with a clear message when the API key is missing."""
    if not connection.has_credentials():
        raise HTTPException(status_code=500, detail=MISSING_KEY_MESSAGE)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    # Re-ask the last question, replacing its failed or unanswered turn
    retry: bool = False


class UpdateConversationRequest(BaseModel):
    """Request to rename a conversation."""
    title: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


def _event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# The frontend sends its language so the default council is named in it
LangHeader = Header(default=None, alias="X-Council-Lang")


def prepare_turn(conversation_id: str, request: SendMessageRequest, lang: Optional[str] = None):
    """
    Validate a new question and return (content, is_first_message, history, settings).
    For a retry, the failed last turn is removed first. The settings are a
    snapshot, so editing them mid-answer doesn't mix two councils.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    require_api_key()

    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if request.retry and storage.remove_failed_last_turn(conversation_id, content):
        conversation = storage.get_conversation(conversation_id)

    settings = council_settings.get_settings(council_settings.normalize_lang(lang))
    is_first_message = len(conversation["messages"]) == 0
    history = build_history(conversation["messages"], settings["history_turns"])
    return content, is_first_message, history, settings


async def _save_title(conversation_id: str, title_task: "asyncio.Task") -> Optional[str]:
    """Store an auto-generated title unless the user renamed the conversation meanwhile."""
    title = await title_task
    if title and storage.update_conversation_title(conversation_id, title, only_if_default=True):
        return title
    return None


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Claude Council API"}


# ---------------------------------------------------------------- council & settings

def _public_council(settings: Dict[str, Any]) -> Dict[str, Any]:
    chairman = settings["chairman"]
    return {
        "members": [
            {k: m[k] for k in ("id", "name", "description", "model", "color")}
            for m in settings["members"]
        ],
        "chairman": {
            "id": "chairman",
            "name": chairman["name"],
            "description": chairman["description"],
            "model": chairman["model"],
        },
        "debate_rounds": settings["debate_rounds"],
        "history_turns": settings["history_turns"],
        "calls_per_question": estimated_calls(settings),
    }


STATUS_TTL_SECONDS = 60
_status_cache: Dict[str, Any] = {"result": None, "at": 0.0}


@app.get("/api/status")
async def get_status(refresh: bool = False):
    """API connection status (cached for a minute unless refresh=true)."""
    now = time.monotonic()
    cached = _status_cache["result"]
    if cached and not refresh and now - _status_cache["at"] < STATUS_TTL_SECONDS:
        return cached

    settings = council_settings.get_settings()
    probe_model = settings["members"][0]["model"]
    result = {
        **await anthropic_client.check_connection(probe_model),
        "provider": connection.provider_label(),
        "model": probe_model,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    _status_cache.update(result=result, at=now)
    return result


class SetupRequest(BaseModel):
    """Connection from the setup screen. An empty api_key keeps the saved key."""
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    chairman_max_tokens: Optional[int] = None


@app.get("/api/setup")
async def get_setup():
    """Whether a connection is configured (the key itself is never returned)."""
    return connection.public_info()


@app.post("/api/setup")
async def save_setup(request: SetupRequest):
    """Test a connection and, if it works, save it (key encrypted) and use it right away."""
    base_url = (request.base_url or "").strip().rstrip("/") or None
    if base_url and not base_url.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="Sağlayıcı adresi https:// ile başlamalı.")
    model = (request.model or "").strip() or None
    for name, value in (("Max tokens", request.max_tokens), ("Başkan max tokens", request.chairman_max_tokens)):
        if value is not None and not 256 <= value <= 200000:
            raise HTTPException(status_code=400, detail=f"{name} 256 ile 200000 arasında olmalı.")

    typed_key = (request.api_key or "").strip()
    # No key typed: keep the saved key, or adopt the one from the environment
    key = typed_key or connection.saved_key() or connection.env_key() or ""
    if not key:
        raise HTTPException(status_code=400, detail="API anahtarını girin.")

    candidate = connection.build_state(base_url, key, model, request.max_tokens, request.chairman_max_tokens)
    probe_model = model or council_settings.get_settings()["members"][0]["model"]
    result = await anthropic_client.check_connection(probe_model, candidate)
    if result["status"] != "connected":
        raise HTTPException(status_code=400, detail=result["message"])

    # A new or environment key gets stored encrypted; an already saved one is kept as is
    connection.save(
        base_url, typed_key or (None if connection.saved_key() else key), model,
        request.max_tokens, request.chairman_max_tokens,
    )
    _status_cache.update(result=None, at=0.0)
    return {**connection.public_info(), "latency_ms": result.get("latency_ms")}


@app.delete("/api/setup")
async def forget_setup():
    """Delete the saved key and connection."""
    connection.forget()
    _status_cache.update(result=None, at=0.0)
    return connection.public_info()


@app.get("/api/council")
async def get_council(lang: Optional[str] = LangHeader):
    """Council composition (prompts excluded)."""
    return _public_council(council_settings.get_settings(council_settings.normalize_lang(lang)))


def _settings_response(settings: Dict[str, Any], lang: Optional[str] = None) -> Dict[str, Any]:
    return {
        "settings": settings,
        "defaults": council_settings.defaults(council_settings.normalize_lang(lang)),
        "model_suggestions": council_settings.model_suggestions(settings),
        "limits": council_settings.LIMITS,
    }


@app.get("/api/settings")
async def get_settings(lang: Optional[str] = LangHeader):
    """Full editable council settings, including prompts."""
    return _settings_response(council_settings.get_settings(council_settings.normalize_lang(lang)), lang)


@app.put("/api/settings")
async def update_settings(payload: Dict[str, Any], lang: Optional[str] = LangHeader):
    """Validate and save council settings."""
    try:
        saved = council_settings.save_settings(payload)
    except council_settings.SettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _settings_response(saved, lang)


@app.delete("/api/settings")
async def reset_settings(lang: Optional[str] = LangHeader):
    """Restore the default council."""
    lang = council_settings.normalize_lang(lang)
    return _settings_response(council_settings.reset_settings(lang), lang)


# ---------------------------------------------------------------- conversations

@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.patch("/api/conversations/{conversation_id}", response_model=Conversation)
async def update_conversation(conversation_id: str, request: UpdateConversationRequest):
    """Rename a conversation."""
    title = request.title.strip()[:100]
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    if storage.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    storage.update_conversation_title(conversation_id, title)
    return storage.get_conversation(conversation_id)


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    if not storage.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": conversation_id}


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest, lang: Optional[str] = LangHeader):
    """
    Send a message and run the council process.
    Returns the complete response with all stages.
    """
    content, is_first_message, history, settings = prepare_turn(conversation_id, request, lang)
    started = time.monotonic()

    storage.add_user_message(conversation_id, content)

    title_task = asyncio.create_task(generate_conversation_title(content)) if is_first_message else None

    stage1_results, stage2_results, stage3_result, metadata, debate = await run_full_council(
        content, history, settings
    )
    metadata["duration_seconds"] = round(time.monotonic() - started, 1)

    if title_task:
        await _save_title(conversation_id, title_task)

    storage.add_assistant_message(
        conversation_id, stage1_results, stage2_results, stage3_result, metadata, debate
    )

    return {
        "stage1": stage1_results,
        "debate": debate,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest, lang: Optional[str] = LangHeader):
    """
    Send a message and stream the council process.
    Returns Server-Sent Events as each stage (and each discussion round) completes.
    """
    content, is_first_message, history, settings = prepare_turn(conversation_id, request, lang)

    async def event_generator():
        started = time.monotonic()
        title_task = None

        async def title_events():
            """Emit the auto title as soon as it is ready (at most once)."""
            nonlocal title_task
            if title_task and title_task.done():
                task, title_task = title_task, None
                title = await _save_title(conversation_id, task)
                if title:
                    yield _event({'type': 'title_complete', 'data': {'title': title}})

        try:
            storage.add_user_message(conversation_id, content)

            # Title generation runs in parallel with the council
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(content))

            # Stage 1: Collect responses
            yield _event({'type': 'stage1_start'})
            stage1_results = await stage1_collect_responses(content, history, settings)
            if not stage1_results:
                reason = anthropic_client.last_error or "bilinmeyen hata"
                message = f"Konsey üyelerinin hiçbiri cevap veremedi. {reason}"
                storage.add_error_message(conversation_id, message)
                if title_task:
                    title_task.cancel()
                yield _event({'type': 'error', 'message': message})
                return
            failed = failed_members(stage1_results, settings)
            yield _event({'type': 'stage1_complete', 'data': stage1_results, 'failed': failed})
            async for event in title_events():
                yield event

            # Discussion: members reply to each other, round by round
            debate = []
            if settings["debate_rounds"] > 0 and len(stage1_results) > 1:
                yield _event({'type': 'debate_start', 'rounds': settings['debate_rounds']})
                async for round_messages in run_debate(content, stage1_results, settings, history):
                    debate.append(round_messages)
                    yield _event({'type': 'debate_round', 'round': len(debate), 'data': round_messages})
                    async for event in title_events():
                        yield event
                yield _event({'type': 'debate_complete', 'data': debate})

            # Stage 2: Collect rankings
            yield _event({'type': 'stage2_start'})
            stage2_results, label_to_member = await stage2_collect_rankings(content, stage1_results, history, settings)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_member)
            metadata = {
                'label_to_member': label_to_member,
                'aggregate_rankings': aggregate_rankings,
                'failed_members': failed,
            }
            yield _event({'type': 'stage2_complete', 'data': stage2_results, 'metadata': metadata})
            async for event in title_events():
                yield event

            # Stage 3: Synthesize final answer
            yield _event({'type': 'stage3_start'})
            stage3_result = await stage3_synthesize_final(
                content, stage1_results, stage2_results, history, settings, debate
            )
            yield _event({'type': 'stage3_complete', 'data': stage3_result})

            # Title still pending: wait for it now
            if title_task:
                title = await _save_title(conversation_id, title_task)
                title_task = None
                if title:
                    yield _event({'type': 'title_complete', 'data': {'title': title}})

            metadata['usage'] = total_usage(stage1_results, debate, stage2_results, stage3_result)
            metadata['duration_seconds'] = round(time.monotonic() - started, 1)

            storage.add_assistant_message(
                conversation_id, stage1_results, stage2_results, stage3_result, metadata, debate
            )

            yield _event({'type': 'complete', 'metadata': metadata})

        except Exception as e:
            # Store and send the error
            try:
                storage.add_error_message(conversation_id, str(e))
            except Exception:
                pass
            yield _event({'type': 'error', 'message': str(e)})
        finally:
            # Stopped by the client (or failed): don't leave the title call running
            if title_task and not title_task.done():
                title_task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    if not connection.has_credentials():
        print("API anahtarı yok: tarayıcıda açılan kurulum ekranından ekleyin.")
    uvicorn.run(app, host=HOST, port=PORT)
