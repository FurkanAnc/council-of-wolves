"""Tests for conversation history and the conversation management endpoints."""

import pytest
from fastapi.testclient import TestClient

from backend import council, main, storage


# --- build_history -----------------------------------------------------------

def _answer(text, **extra):
    return {"role": "assistant", "stage1": [], "stage2": [], "stage3": {"response": text, **extra}}


def test_history_pairs_questions_with_final_answers():
    messages = [
        {"role": "user", "content": "q1"}, _answer("a1"),
        {"role": "user", "content": "q2"}, _answer("a2"),
    ]
    assert council.build_history(messages) == [("q1", "a1"), ("q2", "a2")]


def test_history_skips_failed_and_unanswered_turns():
    messages = [
        {"role": "user", "content": "q1"}, {"role": "assistant", "error": "boom"},
        {"role": "user", "content": "q2"}, _answer("Hata", error=True),
        {"role": "user", "content": "q3"},  # stopped, never answered
        {"role": "user", "content": "q4"}, _answer("a4"),
    ]
    assert council.build_history(messages) == [("q4", "a4")]


def test_history_keeps_only_recent_turns():
    messages = []
    for i in range(6):
        messages += [{"role": "user", "content": f"q{i}"}, _answer(f"a{i}")]
    assert council.build_history(messages, max_turns=2) == [("q4", "a4"), ("q5", "a5")]


def test_history_messages_alternate_and_end_with_new_question():
    msgs = council.history_messages([("q1", "a1")], "q2")
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[-1]["content"] == "q2"


def test_history_text_empty_without_history():
    assert council.history_text([]) == ""
    assert "q1" in council.history_text([("q1", "a1")])


# --- endpoints ---------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", str(tmp_path))
    return TestClient(main.app)


def test_rename_conversation(client):
    conv = client.post("/api/conversations", json={}).json()
    res = client.patch(f"/api/conversations/{conv['id']}", json={"title": "  Yeni başlık  "})
    assert res.status_code == 200
    assert res.json()["title"] == "Yeni başlık"
    assert client.get("/api/conversations").json()[0]["title"] == "Yeni başlık"


def test_rename_rejects_empty_title(client):
    conv = client.post("/api/conversations", json={}).json()
    assert client.patch(f"/api/conversations/{conv['id']}", json={"title": "   "}).status_code == 400


def test_delete_conversation(client):
    conv = client.post("/api/conversations", json={}).json()
    assert client.delete(f"/api/conversations/{conv['id']}").status_code == 200
    assert client.get(f"/api/conversations/{conv['id']}").status_code == 404
    assert client.get("/api/conversations").json() == []
    assert client.delete(f"/api/conversations/{conv['id']}").status_code == 404


def test_council_endpoint_has_descriptions_but_no_prompts(client):
    data = client.get("/api/council").json()
    assert len(data["members"]) == 4
    assert all(m["description"] for m in data["members"])
    assert "system_prompt" not in data["members"][0]
    assert data["chairman"]["name"] == "Başkan"
