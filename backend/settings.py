"""Editable council settings, stored as JSON next to the conversations."""

import copy
import json
import os
import re
import unicodedata
from typing import Any, Dict, List

from . import config, connection

LIMITS = {
    "min_members": 2,
    "max_members": 6,
    "max_debate_rounds": 3,
    "max_history_turns": 10,
    "max_name": 40,
    "max_description": 160,
    "max_model": 100,
    "max_text": 8000,
    "colors": 8,
}


class SettingsError(ValueError):
    """Invalid settings; the message is shown to the user."""


def defaults() -> Dict[str, Any]:
    """Default council; with a model chosen at setup, every member uses it."""
    data = copy.deepcopy(config.DEFAULT_SETTINGS)
    model = connection.current()["model"]
    if model:
        for member in data["members"]:
            member["model"] = model
        data["chairman"]["model"] = model
    return data


def settings_path() -> str:
    return config.SETTINGS_FILE


_cache: Dict[str, Any] = {"mtime": None, "settings": None}


def get_settings() -> Dict[str, Any]:
    """Current settings: the saved file if valid, otherwise the defaults."""
    path = settings_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return defaults()

    if _cache["mtime"] == (path, mtime):
        return copy.deepcopy(_cache["settings"])

    try:
        with open(path, "r", encoding="utf-8") as f:
            loaded = validate(json.load(f))
    except (OSError, ValueError) as e:
        print(f"Ignoring invalid settings file {path}: {e}", flush=True)
        return defaults()

    _cache.update(mtime=(path, mtime), settings=loaded)
    return copy.deepcopy(loaded)


def save_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and store settings; returns the normalized copy."""
    normalized = validate(data)
    path = settings_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)
    return normalized


def reset_settings() -> Dict[str, Any]:
    """Delete the saved settings so the defaults apply again."""
    try:
        os.remove(settings_path())
    except FileNotFoundError:
        pass
    return defaults()


# ---------------------------------------------------------------- validation

def _text(value: Any, field: str, max_len: int, required: bool = True) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise SettingsError(f"{field} metin olmalı.")
    value = value.strip()
    if required and not value:
        raise SettingsError(f"{field} boş olamaz.")
    if len(value) > max_len:
        raise SettingsError(f"{field} en fazla {max_len} karakter olabilir.")
    return value


def _int(value: Any, field: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SettingsError(f"{field} bir tam sayı olmalı.")
    if not low <= value <= high:
        raise SettingsError(f"{field} {low} ile {high} arasında olmalı.")
    return value


def _slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name.replace("ı", "i")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:30] or "uye"


_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def validate(data: Any) -> Dict[str, Any]:
    """Return a normalized copy of `data` or raise SettingsError."""
    if not isinstance(data, dict):
        raise SettingsError("Ayarlar bir nesne olmalı.")

    members_in = data.get("members")
    if not isinstance(members_in, list):
        raise SettingsError("Üye listesi eksik.")
    if not LIMITS["min_members"] <= len(members_in) <= LIMITS["max_members"]:
        raise SettingsError(
            f"Konseyde {LIMITS['min_members']} ile {LIMITS['max_members']} arasında üye olmalı."
        )

    members: List[Dict[str, Any]] = []
    used_ids, used_names, used_colors = set(), set(), set()
    for index, raw in enumerate(members_in, start=1):
        if not isinstance(raw, dict):
            raise SettingsError(f"{index}. üye geçersiz.")
        name = _text(raw.get("name"), f"{index}. üyenin adı", LIMITS["max_name"])
        key = name.casefold()
        if key in used_names:
            raise SettingsError(f"“{name}” adı birden fazla üyede kullanılıyor; adlar farklı olmalı.")
        used_names.add(key)

        member_id = raw.get("id") if isinstance(raw.get("id"), str) else ""
        if not _ID_PATTERN.match(member_id or "") or member_id in used_ids or member_id == "chairman":
            base = _slug(name)
            member_id, n = base, 2
            while member_id in used_ids or member_id == "chairman":
                member_id, n = f"{base}-{n}", n + 1
        used_ids.add(member_id)

        color = raw.get("color")
        if isinstance(color, bool) or not isinstance(color, int) or not 1 <= color <= LIMITS["colors"] or color in used_colors:
            color = None
        members.append({
            "id": member_id,
            "name": name,
            "description": _text(raw.get("description"), f"{name} açıklaması", LIMITS["max_description"], required=False),
            "model": _text(raw.get("model"), f"{name} modeli", LIMITS["max_model"]),
            "color": color,
            "role": _text(raw.get("role"), f"{name} rol talimatı", LIMITS["max_text"]),
        })
        if color:
            used_colors.add(color)

    # Members without a valid color get the first free one
    free = [c for c in range(1, LIMITS["colors"] + 1) if c not in used_colors]
    for member in members:
        if member["color"] is None:
            member["color"] = free.pop(0)

    chairman_in = data.get("chairman")
    if not isinstance(chairman_in, dict):
        raise SettingsError("Başkan ayarları eksik.")
    chairman = {
        "name": _text(chairman_in.get("name"), "Başkanın adı", LIMITS["max_name"]),
        "description": _text(chairman_in.get("description"), "Başkan açıklaması", LIMITS["max_description"], required=False),
        "model": _text(chairman_in.get("model"), "Başkanın modeli", LIMITS["max_model"]),
        "instructions": _text(chairman_in.get("instructions"), "Başkan talimatı", LIMITS["max_text"]),
    }
    if chairman["name"].casefold() in used_names:
        raise SettingsError("Başkanın adı bir üyeyle aynı olamaz.")

    return {
        "preamble": _text(data.get("preamble"), "Ortak üye talimatı", LIMITS["max_text"]),
        "members": members,
        "chairman": chairman,
        "judge_instructions": _text(data.get("judge_instructions"), "Hakem talimatı", LIMITS["max_text"]),
        "debate_rounds": _int(data.get("debate_rounds"), "Tartışma turu sayısı", 0, LIMITS["max_debate_rounds"]),
        "history_turns": _int(data.get("history_turns"), "Bağlam turu sayısı", 0, LIMITS["max_history_turns"]),
    }


def model_suggestions(settings: Dict[str, Any]) -> List[str]:
    """Model ids worth offering in the settings form."""
    models = [connection.current()["model"], config.OPUS, config.SONNET, config.TITLE_MODEL]
    models += [m["model"] for m in settings["members"]] + [settings["chairman"]["model"]]
    return list(dict.fromkeys(m for m in models if m))
