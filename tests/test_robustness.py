"""Security and robustness tests: ids, storage, retry, parsing, usage."""

import json
import os

import pytest
from fastapi.testclient import TestClient

from backend import connection, anthropic_client, council, main, storage


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    conversations = tmp_path / "data" / "conversations"
    conversations.mkdir(parents=True)
    monkeypatch.setattr(storage, "DATA_DIR", str(conversations))
    return conversations


@pytest.fixture
def client(data_dir):
    return TestClient(main.app)


# --- conversation ids cannot escape the data directory -------------------------

@pytest.mark.parametrize("bad_id", ["..%5C..%5Cvictim", "..%5Cvictim", "a.b", "%2E%2E"])
def test_unsafe_ids_are_rejected(client, data_dir, bad_id):
    victim = data_dir.parent.parent / "victim.json"
    victim.write_text('{"id": "x", "created_at": "", "title": "SECRET", "messages": []}', encoding="utf-8")

    assert client.get(f"/api/conversations/{bad_id}").status_code == 404
    assert client.delete(f"/api/conversations/{bad_id}").status_code == 404
    assert client.patch(f"/api/conversations/{bad_id}", json={"title": "x"}).status_code == 404
    assert victim.exists()


def test_storage_refuses_unsafe_path():
    with pytest.raises(ValueError):
        storage.get_conversation_path("..\\x")


# --- storage robustness --------------------------------------------------------

def test_corrupt_file_does_not_break_listing(client, data_dir):
    conv = client.post("/api/conversations", json={}).json()
    (data_dir / "broken.json").write_text("{not json", encoding="utf-8")
    ids = [c["id"] for c in client.get("/api/conversations").json()]
    assert ids == [conv["id"]]


def test_writes_leave_no_temp_files(client, data_dir):
    conv = client.post("/api/conversations", json={}).json()
    client.patch(f"/api/conversations/{conv['id']}", json={"title": "Yeni"})
    assert sorted(os.listdir(data_dir)) == [f"{conv['id']}.json"]


def test_empty_message_rejected(client, monkeypatch):
    monkeypatch.setattr(connection, "has_credentials", lambda: True)
    conv = client.post("/api/conversations", json={}).json()
    res = client.post(f"/api/conversations/{conv['id']}/message/stream", json={"content": "   "})
    assert res.status_code == 400


# --- auto title never overwrites a manual rename -------------------------------

def test_auto_title_respects_manual_rename(data_dir):
    storage.create_conversation("c1")
    assert storage.update_conversation_title("c1", "Auto", only_if_default=True)
    storage.update_conversation_title("c1", "Benim adım")
    assert not storage.update_conversation_title("c1", "Auto 2", only_if_default=True)
    assert storage.get_conversation("c1")["title"] == "Benim adım"


# --- retry removes only a failed or unanswered last turn -----------------------

def _conv_with(messages):
    storage.create_conversation("r1")
    conv = storage.get_conversation("r1")
    conv["messages"] = messages
    storage.save_conversation(conv)


def test_retry_removes_failed_turn(data_dir):
    _conv_with([{"role": "user", "content": "q"}, {"role": "assistant", "error": "boom"}])
    assert storage.remove_failed_last_turn("r1", "q")
    assert storage.get_conversation("r1")["messages"] == []


def test_retry_removes_unanswered_question(data_dir):
    _conv_with([{"role": "user", "content": "q"}])
    assert storage.remove_failed_last_turn("r1", "q")


def test_retry_keeps_successful_turn(data_dir):
    ok = {"role": "assistant", "stage1": [], "stage2": [], "stage3": {"response": "a"}}
    _conv_with([{"role": "user", "content": "q"}, ok])
    assert not storage.remove_failed_last_turn("r1", "q")
    assert len(storage.get_conversation("r1")["messages"]) == 2


def test_retry_requires_same_question(data_dir):
    _conv_with([{"role": "user", "content": "q"}])
    assert not storage.remove_failed_last_turn("r1", "different")


# --- ranking parser tolerates translated headers and labels ---------------------

@pytest.mark.parametrize("text", [
    "Değerlendirme...\nSON SIRALAMA:\n1. Yanıt B\n2. Yanıt A",
    "Değerlendirme...\nFINAL RANKING:\n1. Cevap B\n2. Response A",
    "FINAL RANKING:\n1) **Response B**\n2) **Response A**",
])
def test_parse_ranking_variants(text):
    assert council.parse_ranking_from_text(text) == ["Response B", "Response A"]


# --- usage, failed members, empty answers --------------------------------------

def test_total_usage_sums_all_stages():
    s1 = [{"usage": {"input_tokens": 10, "output_tokens": 5}}, {"usage": {"input_tokens": 1, "output_tokens": 1}}]
    s3 = {"usage": {"input_tokens": 100, "output_tokens": 50}}
    assert council.total_usage(s1, [], s3) == {"input_tokens": 111, "output_tokens": 56}


def test_failed_members_lists_missing_names():
    assert council.failed_members([{"member_id": "expert"}, {"member_id": "pragmatist"}]) == ["Şüpheci", "Şeytanın Avukatı"]


class _Block:
    def __init__(self, type_, text=""):
        self.type, self.text = type_, text


class _Usage:
    input_tokens, output_tokens = 12, 34


class _Message:
    def __init__(self, blocks, stop_reason="end_turn"):
        self.content, self.stop_reason, self.usage = blocks, stop_reason, _Usage()


class _Stream:
    def __init__(self, message):
        self.message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self.message


def _fake_client(message):
    class Messages:
        def stream(self, **params):
            return _Stream(message)

    class Client:
        messages = Messages()

        class beta:
            messages = Messages()

        def with_options(self, **kwargs):
            return self

    return Client()


async def test_empty_answer_counts_as_failure(monkeypatch):
    msg = _Message([_Block("thinking")], stop_reason="max_tokens")
    monkeypatch.setattr(anthropic_client, "get_client", lambda: _fake_client(msg))
    assert await anthropic_client.query_model("m", [{"role": "user", "content": "q"}]) is None
    assert "empty answer" in anthropic_client.last_error


async def test_truncated_answer_is_flagged_with_usage(monkeypatch):
    msg = _Message([_Block("text", "yarım cev")], stop_reason="max_tokens")
    monkeypatch.setattr(anthropic_client, "get_client", lambda: _fake_client(msg))
    result = await anthropic_client.query_model("m", [{"role": "user", "content": "q"}])
    assert result == {"content": "yarım cev", "truncated": True, "usage": {"input_tokens": 12, "output_tokens": 34}}
