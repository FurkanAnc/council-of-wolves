"""3-stage Claude Council orchestration (with an optional discussion round)."""

import asyncio
import random
import re
from collections import defaultdict
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from .anthropic_client import query_members_parallel, query_model
from .config import TITLE_MODEL, CHAIRMAN_MAX_TOKENS
from .settings import get_settings

# (question, final answer) pairs from earlier turns of the conversation
History = List[Tuple[str, str]]
Settings = Dict[str, Any]

# Appended to the (editable) judge instructions so rankings stay parseable
JUDGE_LABEL_RULE = (
    "Always refer to each response by its exact label (for example \"Response A\") "
    "and never translate or shorten the labels."
)

DEBATE_WORD_LIMIT = 150


# ---------------------------------------------------------------- prompts

def member_system_prompt(settings: Settings, member: Dict[str, Any]) -> str:
    """Stage 1: shared preamble + the member's own role."""
    return f"{settings['preamble']}\n\n{member['role']}"


def debate_system_prompt(member: Dict[str, Any]) -> str:
    """Discussion: the member keeps its role but now talks to the others."""
    return (
        f"You are {member['name']}, a member of an advisory council discussing the user's "
        f"question with the other members.\n\n{member['role']}\n\n"
        "Always reply in the same language the user writes in."
    )


def judge_system_prompt(settings: Settings) -> str:
    return f"{settings['judge_instructions']}\n\n{JUDGE_LABEL_RULE}"


def chairman_system_prompt(settings: Settings, debated: bool) -> str:
    chairman = settings["chairman"]
    members = settings["members"]
    roster = "\n".join(
        f"- {m['name']}: {m['description'] or 'no description'}" for m in members
    )
    steps = "discussed each other's answers, " if debated else ""
    return (
        f"You are {chairman['name']}, the chairman of an advisory council. {len(members)} "
        f"advisors with distinct roles answered the user's question, {steps}and then "
        f"anonymously ranked each other's answers.\n\nThe advisors:\n{roster}\n\n"
        f"{chairman['instructions']}"
    )


# ---------------------------------------------------------------- helpers

def _member_info(member: Dict[str, Any]) -> Dict[str, str]:
    """Public identity fields of a member (no prompts)."""
    return {"member_id": member["id"], "member_name": member["name"], "model": member["model"]}


def _chairman_info(settings: Settings) -> Dict[str, str]:
    chairman = settings["chairman"]
    return {"member_id": "chairman", "member_name": chairman["name"], "model": chairman["model"]}


def _call_info(response: Dict[str, Any]) -> Dict[str, Any]:
    """Token usage and truncation flag of one model call."""
    info = {"usage": response.get("usage") or {"input_tokens": 0, "output_tokens": 0}}
    if response.get("truncated"):
        info["truncated"] = True
    return info


def failed_members(stage1_results: List[Dict[str, Any]], settings: Optional[Settings] = None) -> List[str]:
    """Names of members who gave no stage 1 answer."""
    settings = settings or get_settings()
    answered = {r["member_id"] for r in stage1_results}
    return [m["name"] for m in settings["members"] if m["id"] not in answered]


def total_usage(*stage_items) -> Dict[str, int]:
    """Sum token usage over stage results (lists, nested lists or single dicts)."""
    totals = {"input_tokens": 0, "output_tokens": 0}

    def add(item):
        if isinstance(item, list):
            for sub in item:
                add(sub)
        elif isinstance(item, dict):
            usage = item.get("usage") or {}
            totals["input_tokens"] += usage.get("input_tokens", 0) or 0
            totals["output_tokens"] += usage.get("output_tokens", 0) or 0

    for item in stage_items:
        add(item)
    return totals


def estimated_calls(settings: Settings, first_message: bool = False) -> int:
    """API calls for one question: answers + discussion + reviews + chairman (+ title)."""
    n = len(settings["members"])
    return n + n * settings["debate_rounds"] + n + 1 + (1 if first_message else 0)


# ---------------------------------------------------------------- history

def build_history(messages: List[Dict[str, Any]], max_turns: int = 4) -> History:
    """
    Extract earlier (question, chairman answer) pairs from stored messages.
    Questions without a successful final answer are skipped.
    """
    history: History = []
    pending_question = None
    for message in messages:
        if message.get("role") == "user":
            pending_question = message.get("content", "")
        elif message.get("role") == "assistant" and pending_question is not None:
            stage3 = message.get("stage3") or {}
            answer = stage3.get("response")
            if answer and not stage3.get("error") and not message.get("error"):
                history.append((pending_question, answer))
            pending_question = None
    return history[-max_turns:] if max_turns > 0 else []


def history_messages(history: History, user_query: str) -> List[Dict[str, str]]:
    """Earlier turns as alternating messages, followed by the new question."""
    messages: List[Dict[str, str]] = []
    for question, answer in history:
        messages.append({"role": "user", "content": question})
        messages.append({"role": "assistant", "content": answer})
    messages.append({"role": "user", "content": user_query})
    return messages


def history_text(history: History, max_answer_chars: int = 2000) -> str:
    """Earlier turns as plain text for the discussion, judge and chairman prompts."""
    if not history:
        return ""
    parts = []
    for question, answer in history:
        if len(answer) > max_answer_chars:
            answer = answer[:max_answer_chars] + " [...]"
        parts.append(f"User: {question}\nCouncil's final answer: {answer}")
    return "Earlier in this conversation (context for the new question):\n\n" + "\n\n".join(parts) + "\n\n"


# ---------------------------------------------------------------- stage 1

async def stage1_collect_responses(
    user_query: str,
    history: History = None,
    settings: Optional[Settings] = None,
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses, each member using its own role prompt.
    Earlier turns (questions + council answers) are sent as conversation context.

    Returns:
        List of dicts with member_id, member_name, model and response
    """
    settings = settings or get_settings()
    members = [{**m, "system_prompt": member_system_prompt(settings, m)} for m in settings["members"]]
    messages = history_messages(history or [], user_query)

    responses = await query_members_parallel(members, messages, use_system_prompt=True)

    stage1_results = []
    for member in members:
        response = responses.get(member["id"])
        if response is not None:  # Only include successful responses
            stage1_results.append({
                **_member_info(member),
                "response": response.get("content", ""),
                **_call_info(response),
            })

    return stage1_results


# ---------------------------------------------------------------- discussion

def format_debate(rounds: List[List[Dict[str, Any]]]) -> str:
    """Discussion transcript as plain text."""
    parts = []
    for number, round_messages in enumerate(rounds, start=1):
        lines = [f"Round {number}:"]
        lines += [f"{m['member_name']}: {m['message']}" for m in round_messages]
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def build_debate_prompt(
    user_query: str,
    member_id: str,
    stage1_results: List[Dict[str, Any]],
    members_by_id: Dict[str, Dict[str, Any]],
    rounds: List[List[Dict[str, Any]]],
    round_number: int,
    total_rounds: int,
    context: str = "",
) -> str:
    own = next(r for r in stage1_results if r["member_id"] == member_id)
    others = []
    for result in stage1_results:
        if result["member_id"] == member_id:
            continue
        description = (members_by_id.get(result["member_id"]) or {}).get("description")
        header = f"### {result['member_name']}" + (f" ({description})" if description else "")
        others.append(f"{header}\n{result['response']}")

    so_far = f"\n\nDiscussion so far:\n\n{format_debate(rounds)}" if rounds else ""

    return f"""{context}The user asked: {user_query}

Your opening answer:
{own['response']}

The other council members' opening answers:

{chr(10).join(others)}{so_far}

This is discussion round {round_number} of {total_rounds}. Reply to the other members directly and address them by name. Say where you agree and where you disagree and why, point out anything important they missed or got wrong, and say whether you would change your own position. Do not repeat your opening answer. Keep it under {DEBATE_WORD_LIMIT} words."""


async def run_debate(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    settings: Optional[Settings] = None,
    history: History = None,
) -> AsyncIterator[List[Dict[str, Any]]]:
    """
    Discussion: members who answered read each other's answers (with names)
    and reply, for `debate_rounds` rounds. Yields each finished round.
    """
    settings = settings or get_settings()
    total = settings["debate_rounds"]
    if total <= 0 or len(stage1_results) < 2:
        return

    members_by_id = {m["id"]: m for m in settings["members"]}
    participants = [members_by_id[r["member_id"]] for r in stage1_results if r["member_id"] in members_by_id]
    context = history_text(history or [])
    rounds: List[List[Dict[str, Any]]] = []

    for number in range(1, total + 1):
        async def speak(member):
            prompt = build_debate_prompt(
                user_query, member["id"], stage1_results, members_by_id, rounds, number, total, context
            )
            return await query_model(
                member["model"], [{"role": "user", "content": prompt}], system=debate_system_prompt(member)
            )

        responses = await asyncio.gather(*(speak(m) for m in participants))
        round_messages = [
            {**_member_info(member), "message": response["content"], **_call_info(response)}
            for member, response in zip(participants, responses)
            if response is not None
        ]
        if not round_messages:
            break  # nobody could reply; don't keep spending calls
        rounds.append(round_messages)
        yield round_messages


# ---------------------------------------------------------------- stage 2

def build_ranking_prompt(
    user_query: str,
    labeled_responses: List[Tuple[str, str]],
    context: str = "",
) -> str:
    """Build the stage 2 prompt from (label, response_text) pairs in presentation order."""
    responses_text = "\n\n".join(
        f"{label}:\n{text}" for label, text in labeled_responses
    )

    return f"""{context}You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section
- Keep "FINAL RANKING:" and the labels in English exactly as shown, even if you write the evaluation in another language

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    history: History = None,
    settings: Optional[Settings] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, str]]]:
    """
    Stage 2: Each member ranks the anonymized stage 1 responses as an impartial judge.

    The label -> member mapping is fixed; only the presentation order of the
    responses is shuffled per judge to reduce first-position bias.

    Returns:
        Tuple of (rankings list, label_to_member mapping)
    """
    settings = settings or get_settings()
    members = settings["members"]
    members_by_id = {m["id"]: m for m in members}
    labels = [f"Response {chr(65 + i)}" for i in range(len(stage1_results))]  # A, B, C, ...

    label_to_member = {
        label: _member_info(members_by_id.get(result["member_id"], {
            "id": result["member_id"], "name": result["member_name"], "model": result["model"],
        }))
        for label, result in zip(labels, stage1_results)
    }
    labeled = [(label, result["response"]) for label, result in zip(labels, stage1_results)]
    context = history_text(history or [])
    system = judge_system_prompt(settings)

    async def judge(member: Dict[str, Any]):
        order = labeled[:]
        random.shuffle(order)
        messages = [{"role": "user", "content": build_ranking_prompt(user_query, order, context)}]
        return await query_model(member["model"], messages, system=system)

    responses = await asyncio.gather(*(judge(m) for m in members))

    stage2_results = []
    for member, response in zip(members, responses):
        if response is not None:
            full_text = response.get("content", "")
            stage2_results.append({
                **_member_info(member),
                "ranking": full_text,
                "parsed_ranking": parse_ranking_from_text(full_text),
                **_call_info(response),
            })

    return stage2_results, label_to_member


# ---------------------------------------------------------------- stage 3

async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    history: History = None,
    settings: Optional[Settings] = None,
    debate: Optional[List[List[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """
    Stage 3: Chairman sees all responses with role names, the discussion and all evaluations.

    Returns:
        Dict with member_id, member_name, model and response
    """
    settings = settings or get_settings()
    stage1_text = "\n\n".join(
        f"Advisor: {result['member_name']}\nResponse: {result['response']}"
        for result in stage1_results
    )

    stage2_text = "\n\n".join(
        f"Evaluator: {result['member_name']}\nEvaluation: {result['ranking']}"
        for result in stage2_results
    )

    debate_text = f"\n\nDISCUSSION BETWEEN THE ADVISORS:\n{format_debate(debate)}" if debate else ""

    chairman_prompt = f"""{history_text(history or [], max_answer_chars=4000)}Original Question: {user_query}

ADVISOR ANSWERS:
{stage1_text}{debate_text}

ANONYMOUS PEER EVALUATIONS (labels "Response A, B, ..." referred to the advisor answers above in the same order):
{stage2_text}

Now write the final answer to the original question."""

    response = await query_model(
        settings["chairman"]["model"],
        [{"role": "user", "content": chairman_prompt}],
        system=chairman_system_prompt(settings, debated=bool(debate)),
        max_tokens=CHAIRMAN_MAX_TOKENS,
    )

    if response is None:
        return {
            **_chairman_info(settings),
            "response": "Hata: Son cevap üretilemedi.",
            "error": True,
        }

    return {
        **_chairman_info(settings),
        "response": response.get("content", ""),
        **_call_info(response),
    }


# ---------------------------------------------------------------- parsing

# Ranking headers and labels models sometimes translate (Turkish variants included)
_RANKING_HEADER = re.compile(r'(?:FINAL RANKING|SON SIRALAMA|N[İI]HA[İI] SIRALAMA)\s*:', re.IGNORECASE)
_LABEL_VARIANT = re.compile(r'\b(?:Response|Yan[ıi]t|Cevap)\s+([A-Z])\b')


def _normalize_labels(text: str) -> str:
    """Rewrite "Yanıt A" / "Cevap A" to "Response A"."""
    return _LABEL_VARIANT.sub(lambda m: f"Response {m.group(1)}", text)


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Returns:
        List of response labels in ranked order
    """
    parts = _RANKING_HEADER.split(ranking_text)
    if len(parts) >= 2:
        ranking_section = _normalize_labels(parts[-1])
        # Numbered list format (e.g., "1. Response A")
        numbered_matches = re.findall(r'\d+[.)]\s*\**Response [A-Z]', ranking_section)
        if numbered_matches:
            return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

        # Fallback: all "Response X" patterns in order
        return re.findall(r'Response [A-Z]', ranking_section)

    # Fallback: any "Response X" patterns in order
    return re.findall(r'Response [A-Z]', _normalize_labels(ranking_text))


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_member: Dict[str, Dict[str, str]]
) -> List[Dict[str, Any]]:
    """
    Calculate average rank per member (not per model, so members sharing a
    model are counted separately).

    Returns:
        List of dicts with member info and average rank, sorted best to worst
    """
    member_positions = defaultdict(list)

    for ranking in stage2_results:
        parsed_ranking = parse_ranking_from_text(ranking["ranking"])
        seen = set()
        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_member and label not in seen:
                seen.add(label)
                member_positions[label].append(position)

    aggregate = []
    for label, positions in member_positions.items():
        avg_rank = sum(positions) / len(positions)
        aggregate.append({
            **label_to_member[label],
            "average_rank": round(avg_rank, 2),
            "rankings_count": len(positions),
        })

    aggregate.sort(key=lambda x: x["average_rank"])
    return aggregate


# ---------------------------------------------------------------- title

async def generate_conversation_title(user_query: str) -> str:
    """Generate a short title (3-5 words) for a conversation; empty string on failure."""
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive, in the same language as the question. Do not use quotes or punctuation in the title. Reply with the title only.

Question: {user_query}"""

    messages = [{"role": "user", "content": title_prompt}]

    response = await query_model(TITLE_MODEL, messages, max_tokens=1024, timeout=60.0, effort="low")

    if response is None or not response.get("content"):
        return ""

    title = response["content"].strip().splitlines()[0]
    # Drop markdown decoration, then a leading "Title:" the model may add
    title = re.sub(r'[*_`#]', '', title)
    title = re.sub(r'^\s*(?:title|başlık)\s*:\s*', '', title, flags=re.IGNORECASE)
    title = title.strip().strip('"\'“”').strip()

    if len(title) > 50:
        title = title[:47] + "..."

    return title


# ---------------------------------------------------------------- full run

async def run_full_council(
    user_query: str,
    history: History = None,
    settings: Optional[Settings] = None,
) -> Tuple[List, List, Dict, Dict, List]:
    """
    Run the complete council process (non-streaming).

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata, debate_rounds)
    """
    settings = settings or get_settings()
    stage1_results = await stage1_collect_responses(user_query, history, settings)

    if not stage1_results:
        return [], [], {
            **_chairman_info(settings),
            "response": "Konsey üyelerinin hiçbiri cevap veremedi. Lütfen tekrar deneyin.",
            "error": True,
        }, {}, []

    debate = [r async for r in run_debate(user_query, stage1_results, settings, history)]

    stage2_results, label_to_member = await stage2_collect_rankings(user_query, stage1_results, history, settings)

    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_member)

    stage3_result = await stage3_synthesize_final(
        user_query, stage1_results, stage2_results, history, settings, debate
    )

    metadata = {
        "label_to_member": label_to_member,
        "aggregate_rankings": aggregate_rankings,
        "failed_members": failed_members(stage1_results, settings),
        "usage": total_usage(stage1_results, debate, stage2_results, stage3_result),
    }

    return stage1_results, stage2_results, stage3_result, metadata, debate
