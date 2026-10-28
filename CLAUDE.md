# CLAUDE.md - Technical Notes for Claude Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

Claude Council is a 3-stage deliberation system where several Claude-based council members, each with its own role, collaboratively answer user questions. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- `DEFAULT_SETTINGS`: default council (preamble, members with `id/name/description/model/color/role`, chairman, judge instructions, `debate_rounds`, `history_turns`)
- Model IDs `OPUS` / `SONNET` are defined once at the top; `TITLE_MODEL`

**`settings.py`**
- Editable council stored in `SETTINGS_FILE` (default `data/council.json`); `get_settings()` returns a validated copy (falls back to defaults if missing/invalid)
- `validate()` normalizes ids (safe slugs), assigns free color slots (1-8), enforces 2-6 unique members and length limits; raises `SettingsError` with a Turkish message
- Every request takes a settings snapshot in `prepare_turn`, so edits never mix councils mid-answer
- Uses `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` for Anthropic-compatible providers (`COMPAT_MODE`: no betas/fallbacks/effort)
- `ANTHROPIC_MODEL` / `OPUS_MODEL` / `SONNET_MODEL` override model IDs
- Backend runs on **port 8001** (NOT 8000 - user had another app on 8000)
- Binds to `HOST` (default 127.0.0.1); `DATA_DIR` defaults to <project>/data/conversations

**`anthropic_client.py`**
- `query_model()`: Single async Claude call (streamed, text blocks joined, server-side refusal fallback enabled)
- `query_members_parallel()`: Parallel queries keyed by MEMBER ID (never by model - two members can share a model)
- Returns dict with 'content'
- Graceful degradation: returns None on failure, continues with successful responses

**`council.py`** - The Core Logic
- All stage functions take a `settings` snapshot; prompts are built by `member_system_prompt`, `debate_system_prompt`, `judge_system_prompt`, `chairman_system_prompt` (chairman gets the member roster prepended)
- `stage1_collect_responses()`: Parallel queries to all council members
- `run_debate()`: async generator, one discussion round per yield; members see others' answers by name plus earlier rounds; the chairman gets the transcript
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_member` mapping for de-anonymization (fixed; only presentation order is shuffled per judge)
  - Uses the impartial `JUDGE_SYSTEM_PROMPT` instead of role prompts
  - Returns tuple: (rankings_list, label_to_member_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position per member across all peer evaluations

**`storage.py`**
- JSON-based conversation storage in `data/conversations/`
- Conversation ids are validated (`is_valid_id`) so a URL id can never point outside DATA_DIR
- Writes are atomic (temp file + os.replace); unreadable files are skipped in listings
- `remove_failed_last_turn` backs the retry flow; auto titles use `only_if_default` so manual renames win
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3, metadata}`
- metadata (label_to_member, aggregate_rankings) is persisted so reloaded conversations de-anonymize correctly
- Old records may only have `model` fields / `label_to_model`; the frontend handles both

**`main.py`**
- FastAPI app with CORS enabled for localhost:5173 and localhost:3000
- POST `/api/conversations/{id}/message` returns metadata in addition to stages
- Metadata includes: label_to_member mapping and aggregate_rankings
- GET `/api/council` returns members' id/name/description/model/color, debate rounds and calls per question (no prompts)
- GET/PUT/DELETE `/api/settings` read, save (400 with a readable message on invalid input) and reset the council
- Stream events: stage1_*, debate_start / debate_round / debate_complete, stage2_*, stage3_*, title_complete, complete (with usage + duration metadata), error

### Frontend Structure (`frontend/src/`)

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Display labels go through `utils/labels.js` (`memberLabel` -> "Şüpheci · Opus")

**`components/ChatInterface.jsx`**
- Multiline textarea (3 rows, resizable)
- Enter to send, Shift+Enter for new line
- User messages wrapped in markdown-content class for padding

**`components/Stage1.jsx`**
- Tab view of individual model responses
- ReactMarkdown rendering with markdown-content wrapper

**`components/Stage2.jsx`**
- **Critical Feature**: Tab view showing RAW evaluation text from each model
- De-anonymization happens CLIENT-SIDE for display (models receive anonymous labels)
- Shows "Extracted Ranking" below each evaluation so users can validate parsing
- Aggregate rankings shown with average position and vote count
- Explanatory text clarifies that boldface model names are for readability only

**`components/Stage3.jsx`**
- Final synthesized answer from chairman
- Green-tinted background (#f0fff0) to highlight conclusion

**Styling (`*.css`)**
- Light mode theme (not dark mode)
- Primary color: #4a90e2 (blue)
- Global markdown styling in `index.css` with `.markdown-content` class
- 12px padding on all markdown content to prevent cluttered appearance

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": {"member_id": "expert", "member_name": "Uzman", "model": "claude-opus-5-5"}, ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- Backend: 8001 (changed from 8000 to avoid conflict)
- Frontend: 5173 (Vite default)
- Update both `backend/main.py` and `frontend/src/api.js` if changing

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Members are defined in `backend/config.py`. The chairman (Opus) is separate from the four members.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Shared models**: never key results by model name - two members use Opus and two use Sonnet
5. **Member colors** follow the member (`color` slot in settings), not its position; the frontend reads them via `setCouncilColors`
6. **Tests** use `tests/conftest.py` to point `SETTINGS_FILE` at a temp file, never the real `data/council.json`

## Future Enhancement Ideas

- Configurable council/chairman via UI instead of config file
- Streaming responses instead of batch loading
- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Support for reasoning models (o1, etc.) with special handling

## Testing Notes

Run `uv run pytest` - tests in `tests/` mock the API (no credit spent).

## Data Flow Summary

```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.
