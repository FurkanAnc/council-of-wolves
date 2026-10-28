"""End-to-end test of the streaming endpoint with a fake model."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import connection, anthropic_client, council, main, storage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(connection, "has_credentials", lambda: True)

    async def fake_query(model, messages, system=None, **kwargs):
        prompt = messages[-1]["content"]
        if "Generate a very short title" in prompt:
            return {"content": "**Başlık:** Kahve Çay", "usage": {"input_tokens": 1, "output_tokens": 1}}
        if "FINAL RANKING" in prompt:
            text = "Yanıt A iyi.\nSON SIRALAMA:\n1. Yanıt A\n2. Yanıt B\n3. Yanıt C\n4. Yanıt D"
        else:
            text = f"answer from {system[-30:] if system else 'chairman'}"
        return {"content": text, "usage": {"input_tokens": 10, "output_tokens": 5}}

    monkeypatch.setattr(anthropic_client, "query_model", fake_query)
    monkeypatch.setattr(council, "query_model", fake_query)
    return TestClient(main.app)


def _events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_stream_runs_all_stages_and_saves(client):
    conv = client.post("/api/conversations", json={}).json()
    res = client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "Kahve mi çay mı?"})
    events = _events(res)
    types = [e["type"] for e in events]

    assert types[:2] == ["stage1_start", "stage1_complete"]
    assert types[-1] == "complete"
    assert "title_complete" in types and "error" not in types

    title = next(e for e in events if e["type"] == "title_complete")["data"]["title"]
    assert title == "Kahve Çay"

    done = events[-1]["metadata"]
    # 4 answers + 4 discussion replies + 4 reviews + chairman, 10 input / 5 output tokens each
    assert done["usage"] == {"input_tokens": 130, "output_tokens": 65}
    assert done["failed_members"] == []
    assert done["aggregate_rankings"][0]["member_id"] == "expert"
    assert "duration_seconds" in done

    saved = client.get(f"/api/conversations/{conv['id']}").json()
    assert saved["title"] == "Kahve Çay"
    assert [m["role"] for m in saved["messages"]] == ["user", "assistant"]
    assert saved["messages"][1]["metadata"]["usage"]["output_tokens"] == 65
    assert len(saved["messages"][1]["debate"]) == 1


def test_retry_replaces_failed_turn(client):
    conv = client.post("/api/conversations", json={}).json()
    storage.add_user_message(conv["id"], "q")
    storage.add_error_message(conv["id"], "boom")

    res = client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "q", "retry": True})
    assert _events(res)[-1]["type"] == "complete"

    messages = client.get(f"/api/conversations/{conv['id']}").json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert "error" not in messages[1]


def test_follow_up_sends_history(client, monkeypatch):
    seen = []
    original = council.query_model

    async def recording(model, messages, system=None, **kwargs):
        seen.append(messages)
        return await original(model, messages, system=system, **kwargs)

    monkeypatch.setattr(anthropic_client, "query_model", recording)

    conv = client.post("/api/conversations", json={}).json()
    client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "ilk soru"})
    seen.clear()
    client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "takip sorusu"})

    # Stage 1 calls get the earlier question and the chairman's answer as context
    stage1_call = seen[0]
    assert [m["role"] for m in stage1_call] == ["user", "assistant", "user"]
    assert stage1_call[0]["content"] == "ilk soru"
    assert stage1_call[-1]["content"] == "takip sorusu"
