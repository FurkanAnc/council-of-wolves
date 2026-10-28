"""Shared test setup."""

import pytest

from backend import config


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Never read or write the real data/council.json during tests."""
    monkeypatch.setattr(config, "SETTINGS_FILE", str(tmp_path / "council.json"))
