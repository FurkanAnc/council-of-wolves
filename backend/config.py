"""Configuration for the Claude Council."""

import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_ROOT / ".env")

# Fallback credentials from the environment / .env. The connection saved from
# the setup screen takes precedence (see backend/connection.py).
# ANTHROPIC_API_KEY for the Anthropic API, or ANTHROPIC_AUTH_TOKEN (Bearer) for
# Anthropic-compatible providers at ANTHROPIC_BASE_URL (e.g. https://platform.yeta.ai).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY") or None
ANTHROPIC_AUTH_TOKEN = os.getenv("ANTHROPIC_AUTH_TOKEN") or None
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL") or None

# Model IDs (https://docs.claude.com/en/docs/about-claude/models).
# ANTHROPIC_MODEL replaces both; OPUS_MODEL / SONNET_MODEL replace one each.
_override = os.getenv("ANTHROPIC_MODEL") or None
OPUS = os.getenv("OPUS_MODEL") or _override or "claude-opus-5-5"
SONNET = os.getenv("SONNET_MODEL") or _override or "claude-sonnet-5-5"

# Model used for conversation titles
TITLE_MODEL = SONNET

# ---------------------------------------------------------------------------
# Default council. These are the starting values; the settings screen edits a
# copy saved in SETTINGS_FILE (see backend/settings.py).
# ---------------------------------------------------------------------------

# Shared preamble prepended to every member's role prompt (stage 1)
COUNCIL_PREAMBLE = (
    "You are a member of the Claude Council, a group of advisors who each answer "
    "the user's question independently from a distinct perspective. Answer the "
    "question fully on its own merits; do not mention the council or other members. "
    "Always reply in the same language the user writes in."
)

DEFAULT_JUDGE_INSTRUCTIONS = (
    "You are an impartial judge. Ignore any perspective or persona you may have used "
    "before. Evaluate the responses solely on accuracy, insight, completeness and "
    "usefulness to the user. Responses written from different perspectives are valid; "
    "judge how well each one serves the user, not which perspective you prefer. "
    "Write your evaluation in the same language as the question."
)

DEFAULT_CHAIRMAN_INSTRUCTIONS = (
    "Write the single best final answer to the user's original question. Combine the "
    "strongest points of each advisor, take valid objections seriously, include "
    "concrete actionable steps where useful, and acknowledge credible opposing views. "
    "Resolve disagreements explicitly instead of averaging them. Weigh the peer "
    "rankings, but trust correctness over popularity. Do not describe the council "
    "process; just give the answer. Reply in the user's language."
)

DEFAULT_SETTINGS = {
    "preamble": COUNCIL_PREAMBLE,
    "members": [
        {
            "id": "expert",
            "name": "Uzman",
            "description": "Derin, teknik ve doğruluğu en üst düzeyde cevap",
            "model": OPUS,
            "color": 1,
            "role": (
                "Your role: THE EXPERT. Give the most accurate, rigorous and technically "
                "deep answer you can. Explain the underlying mechanisms, cite "
                "well-established facts, distinguish what is known from what is "
                "uncertain, and prefer precision over breadth."
            ),
        },
        {
            "id": "skeptic",
            "name": "Şüpheci",
            "description": "Varsayımları, hataları ve eksik kanıtları sorgular",
            "model": OPUS,
            "color": 2,
            "role": (
                "Your role: THE SKEPTIC. Answer the question, but focus on what could be "
                "wrong: hidden assumptions, common misconceptions, weak evidence, edge "
                "cases and failure modes. Point out where a naive answer would mislead, "
                "and state your confidence level explicitly."
            ),
        },
        {
            "id": "pragmatist",
            "name": "Pratik",
            "description": "Uygulanabilirlik, somut adımlar ve gerçek dünya kısıtları",
            "model": SONNET,
            "color": 3,
            "role": (
                "Your role: THE PRAGMATIST. Focus on what the user can actually do. Give "
                "concrete, actionable steps, realistic trade-offs, cost and time "
                "considerations, and real-world constraints. Skip theory unless it "
                "changes the decision."
            ),
        },
        {
            "id": "contrarian",
            "name": "Şeytanın Avukatı",
            "description": "En güçlü karşı görüşü savunur",
            "model": SONNET,
            "color": 4,
            "role": (
                "Your role: THE CONTRARIAN. Identify the mainstream or most obvious "
                "answer, then make the strongest honest case for an alternative or "
                "opposing view. Stay factual: argue the best version of the other side, "
                "not a straw man, and say clearly where the contrarian view is weaker."
            ),
        },
    ],
    "chairman": {
        "name": "Başkan",
        "description": "Tüm cevapları ve değerlendirmeleri birleştirip son cevabı yazar",
        "model": OPUS,
        "instructions": DEFAULT_CHAIRMAN_INSTRUCTIONS,
    },
    "judge_instructions": DEFAULT_JUDGE_INSTRUCTIONS,
    # Discussion rounds between stage 1 and the peer review (0 = off)
    "debate_rounds": 1,
    # Previous question/answer turns sent as context for follow-up questions
    "history_turns": 4,
}

# English names/descriptions for the default council (the UI language picks them;
# role instructions are the same in both languages)
DEFAULT_TEXT_EN = {
    "expert": {"name": "Expert", "description": "Deep, technical, maximally accurate answer"},
    "skeptic": {"name": "Skeptic", "description": "Questions assumptions, errors and missing evidence"},
    "pragmatist": {"name": "Pragmatist", "description": "Feasibility, concrete steps and real-world constraints"},
    "contrarian": {"name": "Devil's Advocate", "description": "Argues the strongest opposing view"},
    "chairman": {"name": "The Chair", "description": "Combines all answers and reviews into the final answer"},
}

# Token limits live in the connection (setup screen); thinking tokens count toward them
REQUEST_TIMEOUT = 600.0      # seconds

# Data directory for conversation storage (anchored to the project, not the cwd)
DATA_DIR = os.getenv("DATA_DIR") or str(PROJECT_ROOT / "data" / "conversations")

# Editable council settings (written by the settings screen)
SETTINGS_FILE = os.getenv("SETTINGS_FILE") or str(PROJECT_ROOT / "data" / "council.json")

# Saved connection: encrypted API key and provider / model / token limits
# (shared with start.ps1)
KEY_FILE = os.getenv("KEY_FILE") or str(PROJECT_ROOT / "data" / "api-key.dat")
CONNECTION_FILE = os.getenv("CONNECTION_FILE") or str(PROJECT_ROOT / "data" / "launch.json")

# Backend address; 127.0.0.1 keeps it reachable from this computer only
HOST = os.getenv("HOST") or "127.0.0.1"
PORT = int(os.getenv("PORT") or 8001)
