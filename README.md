# Claude Council

A fork of [karpathy/llm-council](https://github.com/karpathy/llm-council) where every council member is a Claude model with its own role. Instead of asking one model, you ask a council of advisors who each look at the question from a different angle, discuss each other's answers, review each other anonymously, and a chairman writes the final answer.

## How it works

1. **Stage 1: Member answers.** The question goes to every member in parallel, each with its own role (system prompt). The answers appear in tabs.
2. **Discussion (optional, 1-3 rounds).** Members read each other's answers, with names, and reply to each other in character: where they agree, where they disagree, whether they would change their position. Each round sees the previous rounds. It is shown as a chat thread; the chairman reads it too.
3. **Stage 2: Cross review.** Every member gets the other answers anonymized ("Response A, B, C, D") and ranks them as an impartial judge. Role prompts are *not* used here, so the Contrarian doesn't judge contrarily. The order the answers are shown in is shuffled for each judge to reduce first-position bias.
4. **Stage 3: Final answer.** The chairman sees every answer (with role names), the discussion and every review, then writes the final answer.

Follow-up questions work: the last few question/final-answer pairs of the conversation are sent as context (4 by default, adjustable in the settings).

## Features

- Final answer first, with member answers and the cross review in collapsible sections
- Live progress (stage stepper with elapsed time) and a stop button
- Conversations: search, grouped by date, rename (pencil or double-click the title), delete with confirmation
- Copy any answer, export a whole conversation as Markdown
- Light / dark / system theme, mobile layout
- Errors are saved with the conversation, so they are still visible after a reload
- "Tekrar dene" re-asks a failed or stopped question, replacing the failed turn
- Duration and token usage under each answer; a "Kesildi" badge when the token limit cut an answer short; a note when a member gave no answer
- Ctrl+K searches conversations
- **Council settings screen:** add, remove and edit members (name, description, model, role instructions), start from role templates (Etikçi, Yaratıcı, Veri Analisti, Öğretmen, Kullanıcı Savunucusu), edit the chairman and the shared/judge instructions, set discussion rounds and context depth; shows the API calls per question

The backend listens on `127.0.0.1` only and has no login, so it is reachable from this computer only. Set `HOST=0.0.0.0` in `.env` only on a network you trust.

## The default council

| ID | Name | Model | Role |
|---|---|---|---|
| `expert` | Uzman | Opus | Deep, technical, maximally accurate answer |
| `skeptic` | Şüpheci | Opus | Challenges assumptions, errors and missing evidence |
| `pragmatist` | Pratik | Sonnet | Feasibility, concrete steps, real-world constraints |
| `contrarian` | Şeytanın Avukatı | Sonnet | Argues the strongest opposing view |
| `chairman` | Başkan | Opus | Combines all answers and reviews into the final answer |
| (helper) | Title generator | Sonnet | Generates conversation titles |

Model IDs: `claude-opus-5-5` and `claude-sonnet-5-5` (see `backend/config.py`). All members reply in the user's language. Everything in this table can be changed from the settings screen.

## Setup

### 1. Install dependencies

The project uses [uv](https://docs.astral.sh/uv/) for Python.

```bash
uv sync
cd frontend && npm install && cd ..
```

### 2. Run

On Windows, double-click a launcher that runs `start.ps1`, or:

```bash
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

On Linux/macOS:

```bash
./start.sh
```

Or run the two parts separately:

```bash
uv run python -m backend.main      # terminal 1
cd frontend && npm run dev         # terminal 2
```

Then open http://localhost:5173.

### 3. Connect a provider (first launch)

On first launch the app opens a **setup screen**: pick a provider (yeta.ai, Anthropic, or any Anthropic-compatible URL), paste your API key, optionally choose a model and token limits. The connection is tested before it is saved, and applied without a restart.

- The key is stored in `data/api-key.dat`, encrypted with Windows DPAPI (only your Windows user on this computer can read it; on other systems it is a file readable only by you). It is never sent back to the browser, only its last 4 characters.
- Provider, model and token limits go to `data/launch.json`. A model chosen here is used by every member of the default council.
- Change it later in **Ayarlar → Genel → Bağlantıyı değiştir**, or run `start.ps1 -Reset` to start over.

With a custom provider, Anthropic-only features (refusal fallback, effort setting) are not sent and token limits default to 8192. Your questions and answers go to that provider, and its prices apply.

Environment variables still work as a fallback when nothing has been saved (`ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_MODEL`, `MAX_TOKENS`, `CHAIRMAN_MAX_TOKENS`; see `.env.example`).

## Customizing the council

Use **Konsey ayarları** in the sidebar (or "Konseyi düzenle" on the welcome screen). Changes are saved to `data/council.json` and apply to the next question; an answer already in progress keeps the council it started with. "Varsayılanlara dön" restores the defaults, which live in `DEFAULT_SETTINGS` in `backend/config.py`.

- 2 to 6 members; names must be unique. The same model can be used by several members, since results are keyed by member ID.
- Each member's role text is sent after the shared preamble (Advanced tab), which includes the "reply in the user's language" rule.
- The chairman's instructions get the current member list prepended automatically; the judge instructions get the "Response A" label rule appended, so rankings stay parseable.
- **Token limits** are not in the settings screen: `MAX_TOKENS` (answers, discussion, reviews) and `CHAIRMAN_MAX_TOKENS` come from `.env` or `start.ps1`. These models think before answering, and thinking counts toward the limit, so leave headroom.

## Cost

With the default council each question makes **13 API calls** (14 on the first message, for the title): 4 answers + 4 discussion replies + 4 reviews + 1 chairman. Without the discussion it is 9. The settings screen shows the count for your setup. Discussion, review and chairman prompts include every stage 1 answer, so their input gets large for long answers. Expect a single question to cost noticeably more than one direct chat message. Track spend at [console.anthropic.com](https://console.anthropic.com/).

Requests use the API's server-side refusal fallback (`fallbacks: "default"`): if a safety classifier declines a request, the API reroutes it to a suitable fallback model instead of failing.

## Tests

```bash
uv run pytest
```

The tests mock the API and do not spend credit.

## Tech stack

- **Backend:** FastAPI (Python 3.10+), Anthropic Python SDK
- **Frontend:** React + Vite, react-markdown
- **Storage:** JSON files in `data/conversations/`
- **Package management:** uv for Python, npm for JavaScript
