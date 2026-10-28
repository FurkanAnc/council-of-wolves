"""Tests for the API connection status check."""

import httpx
import pytest
from fastapi.testclient import TestClient

import anthropic

from backend import anthropic_client, main


def _status_error(cls, code):
    request = httpx.Request("GET", "https://example.test/v1/models")
    return cls("boom", response=httpx.Response(code, request=request), body=None)


class _FakeClient:
    def __init__(self, models_exc=None, messages_exc=None):
        self.calls = []
        outer = self

        class Models:
            async def list(self, **kwargs):
                outer.calls.append("models")
                if models_exc:
                    raise models_exc

        class Messages:
            async def create(self, **kwargs):
                outer.calls.append(("messages", kwargs["model"], kwargs["max_tokens"]))
                if messages_exc:
                    raise messages_exc

        self.models = Models()
        self.messages = Messages()

    def with_options(self, **kwargs):
        return self


@pytest.fixture
def credentials(connected):
    return connected


async def test_connected_via_models_list(credentials, monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(anthropic_client, "get_client", lambda: fake)
    result = await anthropic_client.check_connection("m")
    assert result["status"] == "connected" and "latency_ms" in result
    assert fake.calls == ["models"]


async def test_falls_back_to_one_token_request(credentials, monkeypatch):
    fake = _FakeClient(models_exc=_status_error(anthropic.NotFoundError, 404))
    monkeypatch.setattr(anthropic_client, "get_client", lambda: fake)
    assert (await anthropic_client.check_connection("probe-model"))["status"] == "connected"
    assert fake.calls == ["models", ("messages", "probe-model", 1)]


@pytest.mark.parametrize("exc, status", [
    (_status_error(anthropic.AuthenticationError, 401), "auth_error"),
    (_status_error(anthropic.PermissionDeniedError, 403), "auth_error"),
    (_status_error(anthropic.InternalServerError, 500), "error"),
    (anthropic.APIConnectionError(request=httpx.Request("GET", "https://example.test")), "unreachable"),
])
async def test_failure_kinds(credentials, monkeypatch, exc, status):
    monkeypatch.setattr(anthropic_client, "get_client", lambda: _FakeClient(models_exc=exc))
    assert (await anthropic_client.check_connection("m"))["status"] == status


async def test_no_key():
    assert (await anthropic_client.check_connection("m"))["status"] == "no_key"


def test_status_endpoint_caches_until_refresh(monkeypatch):
    calls = []

    async def fake_check(model, state=None):
        calls.append(model)
        return {"status": "connected", "message": "ok", "latency_ms": 5}

    monkeypatch.setattr(anthropic_client, "check_connection", fake_check)
    monkeypatch.setattr(main, "_status_cache", {"result": None, "at": 0.0})
    client = TestClient(main.app)

    first = client.get("/api/status").json()
    assert first["status"] == "connected" and first["provider"] and first["model"]
    client.get("/api/status")
    assert len(calls) == 1
    client.get("/api/status?refresh=true")
    assert len(calls) == 2
