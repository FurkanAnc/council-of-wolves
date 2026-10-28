"""Unit tests for the Claude Council backend (no real API calls)."""

import re

import pytest

from backend import anthropic_client, connection, council
from backend.config import OPUS, SONNET
from backend.settings import defaults

DEFAULTS = defaults()
COUNCIL_MEMBERS = [
    {**m, "system_prompt": council.member_system_prompt(DEFAULTS, m)} for m in DEFAULTS["members"]
]


# --- parse_ranking_from_text -------------------------------------------------

def test_parse_ranking_well_formed():
    text = "A is good...\nB is weak...\n\nFINAL RANKING:\n1. Response C\n2. Response A\n3. Response B"
    assert council.parse_ranking_from_text(text) == ["Response C", "Response A", "Response B"]


def test_parse_ranking_ignores_mentions_before_header():
    text = "Response A beats Response B.\nFINAL RANKING:\n1. Response B\n2. Response A"
    assert council.parse_ranking_from_text(text) == ["Response B", "Response A"]


def test_parse_ranking_header_without_numbers():
    text = "FINAL RANKING:\nResponse D, then Response A"
    assert council.parse_ranking_from_text(text) == ["Response D", "Response A"]


def test_parse_ranking_missing_header_falls_back():
    assert council.parse_ranking_from_text("I prefer Response B over Response A") == ["Response B", "Response A"]


def test_parse_ranking_empty():
    assert council.parse_ranking_from_text("") == []


# --- calculate_aggregate_rankings --------------------------------------------

LABEL_TO_MEMBER = {
    "Response A": {"member_id": "expert", "member_name": "Uzman", "model": OPUS},
    "Response B": {"member_id": "skeptic", "member_name": "Şüpheci", "model": OPUS},
    "Response C": {"member_id": "pragmatist", "member_name": "Pratik", "model": SONNET},
}


def _ranking(*labels):
    return {"ranking": "FINAL RANKING:\n" + "\n".join(f"{i}. {l}" for i, l in enumerate(labels, 1))}


def test_aggregate_counts_members_sharing_a_model_separately():
    results = [
        _ranking("Response A", "Response B", "Response C"),
        _ranking("Response B", "Response A", "Response C"),
    ]
    agg = council.calculate_aggregate_rankings(results, LABEL_TO_MEMBER)
    by_id = {a["member_id"]: a for a in agg}

    assert set(by_id) == {"expert", "skeptic", "pragmatist"}
    assert by_id["expert"]["average_rank"] == 1.5
    assert by_id["skeptic"]["average_rank"] == 1.5
    assert by_id["expert"]["rankings_count"] == 2
    assert by_id["skeptic"]["rankings_count"] == 2
    assert agg[-1]["member_id"] == "pragmatist"
    assert by_id["pragmatist"]["member_name"] == "Pratik"


def test_aggregate_ignores_unknown_and_duplicate_labels():
    results = [_ranking("Response A", "Response Z", "Response A")]
    agg = council.calculate_aggregate_rankings(results, LABEL_TO_MEMBER)
    assert agg == [{**LABEL_TO_MEMBER["Response A"], "average_rank": 1.0, "rankings_count": 1}]


# --- query_members_parallel --------------------------------------------------

@pytest.fixture
def fake_query(monkeypatch):
    """Replace the real API call with a fake that echoes the system prompt."""
    calls = []

    async def fake(model, messages, system=None, **kwargs):
        calls.append({"model": model, "system": system, "messages": messages})
        if system and "THE SKEPTIC" in system and "fail-skeptic" in messages[0]["content"]:
            return None
        return {"content": f"{model}|{system[-80:] if system else ''}"}

    monkeypatch.setattr(anthropic_client, "query_model", fake)
    monkeypatch.setattr(council, "query_model", fake)
    return calls


async def test_parallel_returns_one_result_per_member(fake_query):
    result = await anthropic_client.query_members_parallel(
        COUNCIL_MEMBERS, [{"role": "user", "content": "hi"}]
    )
    assert set(result) == {"expert", "skeptic", "pragmatist", "contrarian"}
    # Both Opus members get separate entries and their own role prompts
    assert result["expert"] != result["skeptic"]
    assert all(r is not None for r in result.values())
    assert len(fake_query) == 4
    assert {c["system"] for c in fake_query} == {m["system_prompt"] for m in COUNCIL_MEMBERS}


async def test_parallel_shared_system_prompt(fake_query):
    await anthropic_client.query_members_parallel(
        COUNCIL_MEMBERS, [{"role": "user", "content": "hi"}],
        use_system_prompt=False, system="JUDGE",
    )
    assert all(c["system"] == "JUDGE" for c in fake_query)


async def test_stage1_one_member_failing_does_not_stop_others(fake_query):
    results = await council.stage1_collect_responses("fail-skeptic please")
    assert [r["member_id"] for r in results] == ["expert", "pragmatist", "contrarian"]
    assert results[0]["member_name"] == "Uzman"
    assert results[0]["model"] == OPUS


# --- stage 2 -----------------------------------------------------------------

STAGE1 = [
    {"member_id": m["id"], "member_name": m["name"], "model": m["model"], "response": f"answer-{m['id']}"}
    for m in COUNCIL_MEMBERS
]


async def test_stage2_uses_judge_prompt_and_hides_identities(fake_query):
    stage2, label_to_member = await council.stage2_collect_rankings("q?", STAGE1)

    assert len(stage2) == 4
    assert {c["system"] for c in fake_query} == {council.judge_system_prompt(DEFAULTS)}
    assert label_to_member["Response A"]["member_id"] == "expert"
    assert label_to_member["Response D"]["member_id"] == "contrarian"

    for call in fake_query:
        prompt = call["messages"][0]["content"]
        for m in COUNCIL_MEMBERS:
            assert m["name"] not in prompt
        assert "claude-" not in prompt
        # Each label stays attached to its own answer regardless of shuffling
        for label, info in label_to_member.items():
            assert f"{label}:\nanswer-{info['member_id']}" in prompt


async def test_stage2_shuffles_presentation_order(fake_query, monkeypatch):
    orders = set()
    for _ in range(10):
        fake_query.clear()
        await council.stage2_collect_rankings("q?", STAGE1)
        for call in fake_query:
            orders.add(tuple(re.findall(r"^(Response [A-D]):$", call["messages"][0]["content"], re.M)))
    assert len(orders) > 1


# --- compat mode -------------------------------------------------------------

def test_build_params_anthropic_includes_fallback(monkeypatch):
    monkeypatch.setattr(connection, "current", lambda: {"compat": False})
    p = anthropic_client.build_params("m", [], "sys", 100, "low")
    assert p["fallbacks"] == "default" and p["betas"] and p["output_config"] == {"effort": "low"}


def test_build_params_compat_skips_anthropic_only_fields(monkeypatch):
    monkeypatch.setattr(connection, "current", lambda: {"compat": True})
    p = anthropic_client.build_params("m", [], "sys", 100, "low")
    assert p == {"model": "m", "max_tokens": 100, "messages": [], "system": "sys"}
