"""Tests for editable settings and the discussion round."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import anthropic_client, council, main, settings, storage


def _custom(**overrides):
    data = settings.defaults()
    data.update(overrides)
    return data


# --- validation ----------------------------------------------------------------

def test_defaults_are_valid():
    assert settings.validate(settings.defaults()) == settings.defaults()


@pytest.mark.parametrize("change, message", [
    (lambda d: d.update(members=d["members"][:1]), "arasında üye"),
    (lambda d: d["members"][1].update(name=d["members"][0]["name"].upper()), "birden fazla"),
    (lambda d: d["members"][0].update(role="  "), "boş olamaz"),
    (lambda d: d["members"][0].update(model=""), "boş olamaz"),
    (lambda d: d.update(debate_rounds=9), "arasında olmalı"),
    (lambda d: d.update(history_turns="3"), "tam sayı"),
    (lambda d: d["chairman"].update(name="Uzman"), "Başkanın adı"),
    (lambda d: d["members"][0].update(name="x" * 41), "en fazla"),
])
def test_invalid_settings_are_rejected(change, message):
    data = settings.defaults()
    change(data)
    with pytest.raises(settings.SettingsError, match=message):
        settings.validate(data)


def test_new_members_get_safe_ids_and_free_colors():
    data = settings.defaults()
    data["members"].append({"name": "Etikçi Ünal", "description": "", "model": "m", "role": "Be ethical."})
    data["members"].append({"id": "../evil", "name": "İkinci", "description": "", "model": "m", "role": "r", "color": 1})
    result = settings.validate(data)
    added = result["members"][-2:]
    assert added[0]["id"] == "etikci-unal" and added[0]["color"] == 5
    assert added[1]["id"] == "ikinci" and added[1]["color"] == 6  # color 1 was taken


def test_save_and_reset_roundtrip():
    data = _custom(debate_rounds=2)
    data["members"][0]["name"] = "Profesör"
    settings.save_settings(data)
    assert settings.get_settings()["members"][0]["name"] == "Profesör"
    assert settings.get_settings()["debate_rounds"] == 2
    settings.reset_settings()
    assert settings.get_settings() == settings.defaults()


def test_corrupt_settings_file_falls_back_to_defaults():
    with open(settings.settings_path(), "w", encoding="utf-8") as f:
        f.write("{broken")
    assert settings.get_settings() == settings.defaults()


# --- endpoints -------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", str(tmp_path / "conversations"))
    return TestClient(main.app)


def test_settings_endpoints(client):
    body = client.get("/api/settings").json()
    assert body["settings"] == settings.defaults()
    assert body["limits"]["max_members"] == 6
    assert body["model_suggestions"]

    data = body["settings"]
    data["members"] = data["members"][:2]
    data["debate_rounds"] = 0
    res = client.put("/api/settings", json=data)
    assert res.status_code == 200

    council_info = client.get("/api/council").json()
    assert [m["name"] for m in council_info["members"]] == ["Uzman", "Şüpheci"]
    assert council_info["calls_per_question"] == 2 + 0 + 2 + 1
    assert "role" not in council_info["members"][0]

    assert client.delete("/api/settings").json()["settings"] == settings.defaults()


def test_settings_put_returns_readable_error(client):
    data = settings.defaults()
    data["members"] = []
    res = client.put("/api/settings", json=data)
    assert res.status_code == 400
    assert "üye" in res.json()["detail"]


# --- prompts ---------------------------------------------------------------------

def test_chairman_prompt_lists_current_members():
    data = settings.defaults()
    data["members"] = data["members"][:2]
    prompt = council.chairman_system_prompt(data, debated=True)
    assert "2 advisors" in prompt and "discussed" in prompt
    assert "Uzman" in prompt and "Şeytanın Avukatı" not in prompt
    assert data["chairman"]["instructions"] in prompt


def test_debate_prompt_shows_others_by_name_and_previous_rounds():
    data = settings.defaults()
    members_by_id = {m["id"]: m for m in data["members"]}
    stage1 = [
        {"member_id": "expert", "member_name": "Uzman", "model": "m", "response": "uzman cevabı"},
        {"member_id": "skeptic", "member_name": "Şüpheci", "model": "m", "response": "şüpheci cevabı"},
    ]
    rounds = [[{"member_id": "skeptic", "member_name": "Şüpheci", "message": "Uzman'a katılmıyorum"}]]
    prompt = council.build_debate_prompt("soru", "expert", stage1, members_by_id, rounds, 2, 2)
    assert "Your opening answer:\nuzman cevabı" in prompt
    assert "### Şüpheci" in prompt and "şüpheci cevabı" in prompt
    assert "Şüpheci: Uzman'a katılmıyorum" in prompt
    assert "round 2 of 2" in prompt
    assert "### Uzman" not in prompt


# --- streaming with a custom council and discussion ------------------------------

def _events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


@pytest.fixture
def fake_model(monkeypatch):
    calls = []

    async def fake_query(model, messages, system=None, **kwargs):
        prompt = messages[-1]["content"]
        calls.append({"model": model, "system": system, "prompt": prompt})
        if "Generate a very short title" in prompt:
            return {"content": "Başlık"}
        if "FINAL RANKING" in prompt:
            return {"content": "FINAL RANKING:\n1. Response B\n2. Response A"}
        if "discussion round" in prompt:
            return {"content": "Katılıyorum ama bir itirazım var."}
        return {"content": "cevap"}

    monkeypatch.setattr(anthropic_client, "query_model", fake_query)
    monkeypatch.setattr(council, "query_model", fake_query)
    monkeypatch.setattr(main, "HAS_CREDENTIALS", True)
    return calls


def test_stream_uses_saved_council_and_streams_discussion(client, fake_model):
    data = settings.defaults()
    data["members"] = [
        {"name": "Tarihçi", "description": "Geçmişten örnekler", "model": "model-a", "role": "You are a HISTORIAN."},
        {"name": "Fütürist", "description": "Gelecek senaryoları", "model": "model-b", "role": "You are a FUTURIST."},
    ]
    data["debate_rounds"] = 2
    data["chairman"]["name"] = "Hakem Başkan"
    client.put("/api/settings", json=data)

    conv = client.post("/api/conversations", json={}).json()
    events = _events(client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "q"}))
    types = [e["type"] for e in events]

    assert types.count("debate_round") == 2
    assert types.index("debate_start") < types.index("stage2_start")
    round1 = next(e for e in events if e["type"] == "debate_round")["data"]
    assert {m["member_name"] for m in round1} == {"Tarihçi", "Fütürist"}

    stage1 = next(e for e in events if e["type"] == "stage1_complete")["data"]
    assert {r["model"] for r in stage1} == {"model-a", "model-b"}
    assert events[-1]["type"] == "complete"
    final = next(e for e in events if e["type"] == "stage3_complete")["data"]
    assert final["member_name"] == "Hakem Başkan"

    # Role prompts reached the models; the chairman saw the discussion
    systems = [c["system"] or "" for c in fake_model]
    assert any("HISTORIAN" in s for s in systems) and any("FUTURIST" in s for s in systems)
    chairman_call = next(c for c in fake_model if "ADVISOR ANSWERS" in c["prompt"])
    assert "DISCUSSION BETWEEN THE ADVISORS" in chairman_call["prompt"]

    saved = client.get(f"/api/conversations/{conv['id']}").json()["messages"][1]
    assert len(saved["debate"]) == 2


def test_no_discussion_when_rounds_zero(client, fake_model):
    data = settings.defaults()
    data["debate_rounds"] = 0
    client.put("/api/settings", json=data)

    conv = client.post("/api/conversations", json={}).json()
    events = _events(client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "q"}))
    assert not any(e["type"].startswith("debate") for e in events)
    assert not any("discussion round" in c["prompt"] for c in fake_model)
    assert "debate" not in client.get(f"/api/conversations/{conv['id']}").json()["messages"][1]
