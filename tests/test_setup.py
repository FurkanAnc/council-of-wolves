"""Tests for the saved connection and the first-run setup endpoints."""

import pytest
from fastapi.testclient import TestClient

from backend import anthropic_client, config, connection, main, settings


# --- storage ---------------------------------------------------------------------

def test_key_is_stored_encrypted_and_reloaded():
    connection.save("https://platform.yeta.ai", "sk-secret-abcdef123456", "deepseek-v4.1-flash", 4096, 8192)
    with open(config.KEY_FILE, encoding="utf-8") as f:
        assert "sk-secret" not in f.read()

    connection.reload()
    state = connection.current()
    assert state["source"] == "saved"
    assert state["auth_token"] == "sk-secret-abcdef123456" and state["api_key"] is None  # compat provider
    assert state["compat"] and state["model"] == "deepseek-v4.1-flash"
    assert (state["max_tokens"], state["chairman_max_tokens"]) == (4096, 8192)


def test_anthropic_endpoint_uses_api_key():
    state = connection.build_state(None, "sk-ant-xyz-123456789", None, None, None)
    assert state["api_key"] == "sk-ant-xyz-123456789" and state["auth_token"] is None
    assert not state["compat"] and state["max_tokens"] == 16000


def test_forget_removes_saved_connection():
    connection.save(None, "sk-secret-abcdef123456", None, None, None)
    connection.forget()
    assert not connection.has_credentials()
    assert connection.current()["source"] == "none"


def test_public_info_never_contains_the_key():
    connection.save(None, "sk-secret-abcdef123456", None, None, None)
    info = connection.public_info()
    assert info["configured"] and info["key_hint"] == "…3456"
    assert "sk-secret" not in str(info)


def test_token_client_sends_only_the_token():
    state = connection.build_state("https://platform.yeta.ai", "tok-123456789", None, None, None)
    client = anthropic_client.make_client(state)
    assert client.auth_headers == {"Authorization": "Bearer tok-123456789"}


def test_default_council_follows_the_setup_model():
    connection.save("https://platform.yeta.ai", "sk-secret-abcdef123456", "my-model", None, None)
    data = settings.defaults()
    assert {m["model"] for m in data["members"]} == {"my-model"}
    assert data["chairman"]["model"] == "my-model"


# --- endpoints -------------------------------------------------------------------

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "_status_cache", {"result": None, "at": 0.0})
    return TestClient(main.app)


@pytest.fixture
def check(monkeypatch):
    """Fake connection test; set `result` to control the outcome."""
    calls = []
    outcome = {"result": {"status": "connected", "message": "ok", "latency_ms": 12}}

    async def fake(model, state=None):
        calls.append((model, state))
        return outcome["result"]

    monkeypatch.setattr(anthropic_client, "check_connection", fake)
    return calls, outcome


def test_setup_starts_unconfigured(client):
    assert client.get("/api/setup").json()["configured"] is False


def test_setup_saves_only_after_a_successful_test(client, check):
    calls, outcome = check
    outcome["result"] = {"status": "auth_error", "message": "Anahtar kabul edilmedi (HTTP 401)"}
    res = client.post("/api/setup", json={"base_url": "https://platform.yeta.ai", "api_key": "bad-key-123456"})
    assert res.status_code == 400 and "401" in res.json()["detail"]
    assert not connection.has_credentials()

    outcome["result"] = {"status": "connected", "message": "ok", "latency_ms": 12}
    res = client.post("/api/setup", json={
        "base_url": "https://platform.yeta.ai/", "api_key": "good-key-123456",
        "model": "deepseek-v4.1-flash", "max_tokens": 4096,
    })
    body = res.json()
    assert res.status_code == 200 and body["configured"] and body["provider"] == "platform.yeta.ai"
    assert "good-key" not in str(body)
    assert connection.current()["auth_token"] == "good-key-123456"
    assert connection.current()["base_url"] == "https://platform.yeta.ai"  # trailing slash removed
    # The candidate was tested with the chosen model
    assert calls[-1][0] == "deepseek-v4.1-flash"


def test_setup_without_key_keeps_the_saved_one(client, check):
    client.post("/api/setup", json={"api_key": "first-key-123456"})
    res = client.post("/api/setup", json={"max_tokens": 2048})
    assert res.status_code == 200
    assert connection.current()["api_key"] == "first-key-123456"
    assert connection.current()["max_tokens"] == 2048


@pytest.mark.parametrize("payload, message", [
    ({"api_key": ""}, "anahtar"),
    ({"api_key": "k-123456789", "base_url": "ftp://x"}, "https://"),
    ({"api_key": "k-123456789", "max_tokens": 10}, "256"),
])
def test_setup_rejects_bad_input(client, check, payload, message):
    res = client.post("/api/setup", json=payload)
    assert res.status_code == 400 and message in res.json()["detail"]


def test_forget_endpoint(client, check):
    client.post("/api/setup", json={"api_key": "some-key-123456"})
    assert client.delete("/api/setup").json()["configured"] is False


# --- a key found only in the environment ------------------------------------------

@pytest.fixture
def env_token(monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_AUTH_TOKEN", "env-token-abcdef9876")
    monkeypatch.setattr(config, "ANTHROPIC_BASE_URL", "https://platform.yeta.ai")
    connection.reload()


def test_env_key_still_shows_setup_but_prefilled(client, env_token):
    info = client.get("/api/setup").json()
    assert info["configured"] is False  # setup screen appears
    assert info["env_key_hint"] == "…9876"
    assert info["base_url"] == "https://platform.yeta.ai"
    assert connection.has_credentials()  # the council itself would still work


def test_blank_key_adopts_env_key_and_saves_it(client, check, env_token):
    res = client.post("/api/setup", json={"base_url": "https://platform.yeta.ai", "model": "m"})
    assert res.status_code == 200 and res.json()["configured"] is True
    assert connection.saved_key() == "env-token-abcdef9876"
    assert connection.current()["source"] == "saved"
    assert client.get("/api/setup").json()["env_key_hint"] is None
