"""Shared test setup."""

import pytest

from backend import config, connection


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Never read or write the real data/ files, and ignore credentials in the environment."""
    monkeypatch.setattr(config, "SETTINGS_FILE", str(tmp_path / "council.json"))
    monkeypatch.setattr(config, "KEY_FILE", str(tmp_path / "api-key.dat"))
    monkeypatch.setattr(config, "CONNECTION_FILE", str(tmp_path / "launch.json"))
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
        monkeypatch.setattr(config, name, None)
    for name in ("ANTHROPIC_MODEL", "MAX_TOKENS", "CHAIRMAN_MAX_TOKENS"):
        monkeypatch.delenv(name, raising=False)
    connection.reload()
    yield
    connection.reload()


@pytest.fixture
def connected(monkeypatch):
    """Pretend a (fake) key is configured."""
    state = connection.build_state(None, "sk-test-key-1234", None, None, None)
    monkeypatch.setattr(connection, "_cache", {"state": state})
    return state
