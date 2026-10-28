"""JSON-based storage for conversations."""

import json
import os
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR

DEFAULT_TITLE = "New Conversation"

# Conversation ids are uuid4 strings; anything with dots, slashes or backslashes
# is rejected so an id can never point outside DATA_DIR
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def is_valid_id(conversation_id: str) -> bool:
    return bool(_ID_PATTERN.match(conversation_id or ""))


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation (raises ValueError for unsafe ids)."""
    if not is_valid_id(conversation_id):
        raise ValueError(f"Invalid conversation id: {conversation_id!r}")
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def _write_json(path: str, data: Dict[str, Any]):
    """Write via a temp file and rename, so a crash never leaves a half-written file."""
    tmp_path = f"{path}.tmp"
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": DEFAULT_TITLE,
        "messages": []
    }

    _write_json(get_conversation_path(conversation_id), conversation)
    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found (or the id is invalid)
    """
    if not is_valid_id(conversation_id):
        return None

    path = get_conversation_path(conversation_id)
    if not os.path.exists(path):
        return None

    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()
    _write_json(get_conversation_path(conversation['id']), conversation)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only). Unreadable files are skipped.

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.json'):
            continue
        path = os.path.join(DATA_DIR, filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            conversations.append({
                "id": data["id"],
                "created_at": data.get("created_at", ""),
                "title": data.get("title", DEFAULT_TITLE),
                "message_count": len(data.get("messages", []))
            })
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"Skipping unreadable conversation file {filename}: {e}", flush=True)

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def _load_or_raise(conversation_id: str) -> Dict[str, Any]:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    return conversation


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = _load_or_raise(conversation_id)
    conversation["messages"].append({
        "role": "user",
        "content": content
    })
    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
    debate: Optional[List[List[Dict[str, Any]]]] = None,
):
    """
    Add an assistant message with all stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        metadata: label_to_member mapping, aggregate rankings, usage, timing
        debate: Discussion rounds (each a list of member messages), if any
    """
    conversation = _load_or_raise(conversation_id)
    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "metadata": metadata or {}
    }
    if debate:
        message["debate"] = debate
    conversation["messages"].append(message)
    save_conversation(conversation)


def add_error_message(conversation_id: str, error: str):
    """Store a failed assistant turn so the error is still visible after a reload."""
    conversation = _load_or_raise(conversation_id)
    conversation["messages"].append({
        "role": "assistant",
        "error": error
    })
    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str, only_if_default: bool = False) -> bool:
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
        only_if_default: Skip if the user already renamed it (used for auto titles)

    Returns:
        True if the title was changed
    """
    conversation = _load_or_raise(conversation_id)
    if only_if_default and conversation.get("title", DEFAULT_TITLE) != DEFAULT_TITLE:
        return False
    conversation["title"] = title
    save_conversation(conversation)
    return True


def _is_failed_assistant(message: Dict[str, Any]) -> bool:
    stage3 = message.get("stage3") or {}
    return bool(message.get("error") or stage3.get("error") or not stage3.get("response"))


def remove_failed_last_turn(conversation_id: str, content: str) -> bool:
    """
    For a retry: drop the last question if it is `content` and was left
    unanswered or failed, together with its failed answer.

    Returns:
        True if a turn was removed
    """
    conversation = _load_or_raise(conversation_id)
    messages = conversation["messages"]

    last_user = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "user"), None)
    if last_user is None or messages[last_user].get("content") != content:
        return False

    trailing = messages[last_user + 1:]
    if len(trailing) > 1 or (trailing and not _is_failed_assistant(trailing[0])):
        return False

    conversation["messages"] = messages[:last_user]
    save_conversation(conversation)
    return True


def delete_conversation(conversation_id: str) -> bool:
    """
    Delete a conversation file.

    Returns:
        True if it existed and was deleted
    """
    if not is_valid_id(conversation_id):
        return False
    path = get_conversation_path(conversation_id)
    if not os.path.exists(path):
        return False
    os.remove(path)
    return True
