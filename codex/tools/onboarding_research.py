#!/usr/bin/env python3
"""Onboarding research: Tavily-grounded quiz, then scored recommendations.

Dependency-free, matching topic_research.py. Dry-run (default) rewrites the
fixture pack and never opens a socket. Live calls Tavily only after
check-env.sh tavily passes. Do not set WORKFLOW_MODE=live from this tool.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Script invocation (`python3 codex/tools/onboarding_research.py`) puts this
# directory on sys.path, not the repo root. Unittest imports work either way.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from codex.tools.topic_research import (  # noqa: E402
    DEFAULT_BASE_URL,
    AgentError,
    TavilyClient,
    build_extract_payload,
    clean_claim,
    iter_sentences,
    looks_like_fact,
    normalize_topic,
    publisher_from_url,
    run_tavily_preflight,
    sanitize_provider_json,
    search_results,
    title_from_url,
    unique_source_id,
    usage_credits,
    validate_instance,
    write_json,
)


FIXTURE_PROVIDER = "fixture"
LIVE_PROVIDER = "tavily"
CHOICE_IDS = ("a", "b", "c", "d")
MAX_LIVE_INTERESTS = 3
PREFERRED_QUESTION_COUNT = 5
MIN_QUESTION_COUNT = 3
MAX_QUESTION_COUNT = 8
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
DATE_RE = re.compile(
    r"\b(?:\d{1,2}\s+)?(?:" + "|".join(MONTHS) + r")\s+\d{4}\b",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?%")
MONEY_RE = re.compile(
    r"\$[\d,]+(?:\.\d+)?(?:\s*(?:trillion|billion|million))?",
    re.IGNORECASE,
)
COMMA_NUMBER_RE = re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b")
WORD_NUMBER_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:trillion|billion|million|percent)\b",
    re.IGNORECASE,
)
LEVEL_BEGINNER_BELOW = 0.4
LEVEL_INTERMEDIATE_BELOW = 0.75
REC_TEMPLATES = {
    "beginner": (
        ("{interest} from first principles", "Prerequisites and definitions before the mechanics of {interest}."),
        ("Prerequisites for {interest}", "The scored level points at the vocabulary and setup {interest} rests on."),
        ("Core vocabulary of {interest}", "A grounded starting point for {interest} without jumping to applications."),
    ),
    "intermediate": (
        ("The core mechanism of {interest}", "How {interest} actually works, not just the labels around it."),
        ("Cause and effect in {interest}", "The scored level points at the machinery inside {interest}."),
        ("How {interest} hangs together", "Connect the moving parts of {interest} into one causal picture."),
    ),
    "advanced": (
        ("Applied {interest}", "Take {interest} into adjacent practice rather than restating the basics."),
        ("Adjacent topics around {interest}", "Extensions and neighbouring problems once {interest} is solid."),
        ("{interest} in practice", "Applied and adjacent uses of {interest} at an advanced level."),
    ),
}


@dataclass(frozen=True)
class Paths:
    profile_root: Path
    pack_path: Path
    onboarding_dir: Path
    provider_dir: Path
    status_path: Path
    profile_path: Path


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        run_onboarding(args)
    except AgentError as exc:
        print(f"onboarding-research: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"onboarding-research: {exc}", file=sys.stderr)
        return 1
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, choices=("quiz", "recommend"))
    parser.add_argument("--slug", required=True, help="Learner filesystem key.")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Profile root. Pack is written to onboarding-pack.json.",
    )
    parser.add_argument(
        "--interests",
        action="append",
        nargs="+",
        help="Learner interests (quiz stage; 1–5). Repeatable.",
    )
    parser.add_argument("--goal", help="Optional learner goal.")
    parser.add_argument(
        "--answers-json",
        help="JSON object mapping question id → choice id (recommend stage).",
    )
    parser.add_argument(
        "--mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    parser.add_argument(
        "--fixture-pack",
        type=Path,
        default=default_fixture_pack(),
        help="Recorded onboarding pack for dry-run/test quiz.",
    )
    parser.add_argument(
        "--timeout-seconds",
        default=int(os.environ.get("TAVILY_TIMEOUT_SECONDS", "60")),
        type=int,
    )
    return parser.parse_args(argv)


def default_fixture_pack() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "examples/fixture-run/00-topic-research/onboarding/pack.json"
    )


def run_onboarding(
    args: argparse.Namespace,
    *,
    client: TavilyClient | None = None,
    preflight: bool = True,
) -> dict[str, Any]:
    paths = build_paths(args.output_dir)
    ensure_dirs(paths)
    write_status(paths, "pending", args.stage)
    try:
        if args.stage == "quiz":
            pack = run_quiz_stage(args, paths, client=client, preflight=preflight)
        elif args.stage == "recommend":
            pack = run_recommend_stage(args, paths, client=client, preflight=preflight)
        else:
            raise AgentError(f"unknown stage: {args.stage}")
        write_status(paths, "ready", args.stage)
        return pack
    except Exception as exc:
        write_status(paths, "failed", args.stage, error=str(exc))
        raise


def build_paths(output_dir: Path) -> Paths:
    onboarding_dir = output_dir / "onboarding"
    return Paths(
        profile_root=output_dir,
        pack_path=output_dir / "onboarding-pack.json",
        onboarding_dir=onboarding_dir,
        provider_dir=onboarding_dir / "provider",
        status_path=onboarding_dir / "status.json",
        profile_path=output_dir / "learner-profile.json",
    )


def ensure_dirs(paths: Paths) -> None:
    paths.profile_root.mkdir(parents=True, exist_ok=True)
    paths.onboarding_dir.mkdir(parents=True, exist_ok=True)
    paths.provider_dir.mkdir(parents=True, exist_ok=True)


def write_status(paths: Paths, status: str, stage: str, error: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status, "stage": stage}
    if error:
        payload["error"] = error
    write_json(paths.status_path, payload)


def score_answers(pack: dict[str, Any], answers: dict[str, Any] | None) -> tuple[int, int, str]:
    """Return (correct, total, level). Unanswered questions count as wrong."""
    questions = (pack.get("quiz") or {}).get("questions") or []
    if not isinstance(questions, list) or not questions:
        raise AgentError("onboarding pack has no quiz questions to score")
    given = {str(key): str(value) for key, value in (answers or {}).items()}
    correct = 0
    for question in questions:
        if not isinstance(question, dict):
            continue
        qid = question.get("id")
        if given.get(str(qid)) == question.get("correct_id"):
            correct += 1
    total = len(questions)
    ratio = correct / total
    if ratio < LEVEL_BEGINNER_BELOW:
        level = "beginner"
    elif ratio < LEVEL_INTERMEDIATE_BELOW:
        level = "intermediate"
    else:
        level = "advanced"
    return correct, total, level


def flatten_interests(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw.strip()] if raw.strip() else []
    flat: list[str] = []
    for item in raw:
        if isinstance(item, list):
            flat.extend(str(part).strip() for part in item if str(part).strip())
        elif str(item).strip():
            flat.append(str(item).strip())
    return flat


def load_answers(raw: Any) -> dict[str, str]:
    if raw is None:
        raise AgentError("--answers-json is required for recommend stage")
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AgentError(f"invalid --answers-json: {exc}") from exc
    else:
        raise AgentError("--answers-json must be a JSON object")
    if not isinstance(data, dict):
        raise AgentError("--answers-json must be a JSON object")
    return {str(key): str(value) for key, value in data.items()}


def load_onboarding_pack_schema() -> dict[str, Any]:
    schema_path = Path(__file__).resolve().parents[1] / "contracts" / "onboarding-pack.schema.json"
    return json.loads(schema_path.read_text(encoding="utf-8"))


def validate_pack(pack: dict[str, Any]) -> None:
    validate_instance(pack, load_onboarding_pack_schema())


def load_json_object(path: Path, *, label: str) -> dict[str, Any]:
    if not path.exists():
        raise AgentError(f"{label} not found: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AgentError(f"invalid {label} JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise AgentError(f"{label} must be a JSON object: {path}")
    return payload


def live_client(
    *,
    client: TavilyClient | None,
    preflight: bool,
    timeout_seconds: int,
) -> TavilyClient:
    if preflight:
        run_tavily_preflight()
    if client is not None:
        return client
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise AgentError("TAVILY_API_KEY is required outside dry-run mode")
    return TavilyClient(
        api_key,
        base_url=os.environ.get("TAVILY_BASE_URL", DEFAULT_BASE_URL),
        timeout_seconds=timeout_seconds,
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_date() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def run_quiz_stage(
    args: argparse.Namespace,
    paths: Paths,
    *,
    client: TavilyClient | None,
    preflight: bool,
) -> dict[str, Any]:
    interests = flatten_interests(args.interests)
    if not 1 <= len(interests) <= 5:
        raise AgentError("--interests must have 1–5 values for quiz stage")
    mode = args.mode or "dry-run"
    goal = args.goal.strip() if isinstance(args.goal, str) and args.goal.strip() else None

    if mode == "live":
        pack = live_quiz_pack(
            slug=args.slug,
            interests=interests,
            goal=goal,
            paths=paths,
            client=client,
            preflight=preflight,
            timeout_seconds=args.timeout_seconds,
        )
    else:
        pack = dry_run_quiz_pack(
            slug=args.slug,
            interests=interests,
            goal=goal,
            mode=mode,
            fixture_pack=Path(args.fixture_pack),
            paths=paths,
        )

    validate_pack(pack)
    write_json(paths.pack_path, pack)
    patch_learner_profile(
        paths.profile_path,
        status="quiz",
        interests=interests,
        goal=goal,
    )
    return pack


def dry_run_quiz_pack(
    *,
    slug: str,
    interests: list[str],
    goal: str | None,
    mode: str,
    fixture_pack: Path,
    paths: Paths,
) -> dict[str, Any]:
    persist_intended_search_requests(paths, interests, mode=mode)
    pack = load_json_object(fixture_pack, label="fixture pack")
    pack["slug"] = slug
    pack["interests"] = interests
    if goal:
        pack["goal"] = goal
    else:
        pack.pop("goal", None)
    questions = (pack.get("quiz") or {}).get("questions") or []
    for index, question in enumerate(questions):
        if isinstance(question, dict):
            question["topic"] = interests[index % len(interests)]
    pack["recommendations"] = []
    pack["research"] = {
        "provider": FIXTURE_PROVIDER,
        "mode": mode,
        "credits": 0,
        "calls": 0,
        "queries": [
            {
                "pass": "interests",
                "query": interest_search_query(interest),
                "credits": 0,
            }
            for interest in interests[:MAX_LIVE_INTERESTS]
        ],
    }
    pack["style_notes"] = [
        (
            f"{mode.upper()}: no live Tavily call. research.provider is {FIXTURE_PROVIDER!r}, "
            "credits are 0, and this pack is not live-researched."
        ),
        "Quiz items come from the recorded fixture pack, not a Tavily search.",
    ]
    return pack


def persist_intended_search_requests(paths: Paths, interests: list[str], *, mode: str) -> None:
    payloads = [interest_search_payload(interest) for interest in interests[:MAX_LIVE_INTERESTS]]
    if not payloads:
        return
    write_json(
        paths.provider_dir / "interests-request.json",
        {
            "mode": mode,
            "endpoint": "/search",
            "payload": payloads[0],
            "payloads": payloads,
        },
    )


def interest_search_query(interest: str) -> str:
    return f"{interest} key facts common misconceptions beginner quiz"


def interest_search_payload(interest: str) -> dict[str, Any]:
    return {
        "query": interest_search_query(interest),
        "search_depth": "basic",
        "include_raw_content": "markdown",
        "include_usage": True,
        "max_results": 8,
    }


def live_quiz_pack(
    *,
    slug: str,
    interests: list[str],
    goal: str | None,
    paths: Paths,
    client: TavilyClient | None,
    preflight: bool,
    timeout_seconds: int,
) -> dict[str, Any]:
    tavily = live_client(client=client, preflight=preflight, timeout_seconds=timeout_seconds)
    searched = interests[:MAX_LIVE_INTERESTS]
    payloads = [interest_search_payload(interest) for interest in searched]
    write_json(
        paths.provider_dir / "interests-request.json",
        {
            "mode": "live",
            "endpoint": "/search",
            "payload": payloads[0],
            "payloads": payloads,
        },
    )

    tagged_results: list[dict[str, Any]] = []
    public_results: list[dict[str, Any]] = []
    per_responses: list[dict[str, Any]] = []
    queries: list[dict[str, Any]] = []
    credits = 0
    calls = 0
    for interest, payload in zip(searched, payloads):
        response = tavily.search(payload)
        per_responses.append(response)
        call_credits = usage_credits(response, 1)
        credits += call_credits
        calls += 1
        queries.append({"pass": "interests", "query": payload["query"], "credits": call_credits})
        for result in search_results(response):
            public_results.append(result)
            tagged = dict(result)
            tagged["_interest"] = interest
            tagged_results.append(tagged)

    combined = {
        "results": public_results,
        "usage": {"credits": credits},
        "responses": [sanitize_provider_json(item) for item in per_responses],
    }
    write_json(paths.provider_dir / "interests-response.json", sanitize_provider_json(combined))

    try:
        extract_payload = build_extract_payload(public_results)
    except AgentError as exc:
        raise AgentError("interest search returned no URLs to extract") from exc
    write_json(
        paths.provider_dir / "extract-request.json",
        {"mode": "live", "endpoint": "/extract", "payload": extract_payload},
    )
    extract_response = tavily.extract(extract_payload)
    write_json(
        paths.provider_dir / "extract-response.json",
        sanitize_provider_json(extract_response),
    )
    extract_credits = usage_credits(extract_response, 1)
    credits += extract_credits
    calls += 1
    extract_urls = [
        str(result.get("url"))
        for result in search_results(extract_response)
        if result.get("url")
    ]
    queries.append(
        {
            "pass": "extract",
            "query": "extract " + ", ".join(extract_urls) if extract_urls else "extract",
            "credits": extract_credits,
        }
    )

    url_to_interest = {
        str(result.get("url")): str(result["_interest"])
        for result in tagged_results
        if result.get("url")
    }
    accessed_at = utc_date()
    sources = collect_onboarding_sources(
        [combined, extract_response],
        accessed_at,
    )
    source_by_url = {item["url"]: item["id"] for item in sources}
    facts = collect_quiz_facts(
        tagged_results,
        extract_response,
        url_to_interest,
        source_by_url,
        interests,
    )
    questions = build_questions(facts, interests)
    if len(questions) < MIN_QUESTION_COUNT:
        raise AgentError(
            f"could not ground {MIN_QUESTION_COUNT} quiz questions from Tavily results "
            f"(got {len(questions)})"
        )

    notes = []
    if len(questions) < PREFERRED_QUESTION_COUNT:
        notes.append(
            f"Grounded {len(questions)} quiz questions (preferred {PREFERRED_QUESTION_COUNT}) "
            "from sourced sentences; did not invent extra correct answers."
        )

    pack: dict[str, Any] = {
        "slug": slug,
        "interests": interests,
        "quiz": {"questions": questions},
        "recommendations": [],
        "sources": sources,
        "research": {
            "provider": LIVE_PROVIDER,
            "mode": "live",
            "credits": credits,
            "calls": calls,
            "queries": queries,
        },
        "style_notes": notes,
    }
    if goal:
        pack["goal"] = goal
    return pack


def collect_onboarding_sources(responses: list[dict[str, Any]], accessed_at: str) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    seen_ids: set[str] = set()
    for response in responses:
        for result in search_results(response):
            url = result.get("url")
            if not isinstance(url, str) or not url.strip() or url in seen_urls:
                continue
            seen_urls.add(url)
            source_id = unique_source_id(url, str(result.get("title") or ""), seen_ids)
            seen_ids.add(source_id)
            sources.append(
                {
                    "id": source_id,
                    "title": result.get("title") or title_from_url(url),
                    "url": url,
                    "publisher": publisher_from_url(url),
                    "accessed_at": accessed_at,
                }
            )
    if not sources:
        raise AgentError("research produced no sources")
    return sources


def collect_quiz_facts(
    tagged_results: list[dict[str, Any]],
    extract_response: dict[str, Any],
    url_to_interest: dict[str, str],
    source_by_url: dict[str, str],
    interests: list[str],
) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    seen: set[str] = set()
    fallback_interest = interests[0]

    def add_result(result: dict[str, Any]) -> None:
        url = result.get("url")
        if not isinstance(url, str):
            return
        source_id = source_by_url.get(url)
        if not source_id:
            return
        interest = str(result.get("_interest") or url_to_interest.get(url) or fallback_interest)
        text = " ".join(
            part
            for part in (result.get("raw_content"), result.get("content"))
            if isinstance(part, str) and part.strip()
        )
        for sentence in iter_sentences(text):
            claim = clean_claim(sentence)
            key = normalize_topic(claim)
            if key in seen or not looks_like_fact(claim):
                continue
            if pick_answer_span(claim) is None:
                continue
            seen.add(key)
            facts.append(
                {
                    "sentence": claim,
                    "topic": interest,
                    "source_id": source_id,
                }
            )

    for result in search_results(extract_response):
        tagged = dict(result)
        url = result.get("url")
        if isinstance(url, str) and url in url_to_interest:
            tagged["_interest"] = url_to_interest[url]
        add_result(tagged)
    for result in tagged_results:
        add_result(result)
    return facts


def pick_answer_span(sentence: str) -> str | None:
    for pattern in (DATE_RE, MONEY_RE, PERCENT_RE, COMMA_NUMBER_RE, WORD_NUMBER_RE):
        match = pattern.search(sentence)
        if match:
            return match.group(0).strip()
    year = YEAR_RE.search(sentence)
    if year:
        return year.group(0)
    return None


def collect_span_pool(facts: list[dict[str, str]]) -> list[str]:
    pool: list[str] = []
    seen: set[str] = set()
    for fact in facts:
        span = pick_answer_span(fact["sentence"])
        if not span:
            continue
        key = span.casefold()
        if key in seen:
            continue
        seen.add(key)
        pool.append(span)
    return pool


def build_questions(facts: list[dict[str, str]], interests: list[str]) -> list[dict[str, Any]]:
    pool = collect_span_pool(facts)
    remaining = list(facts)
    questions: list[dict[str, Any]] = []
    used_topics: dict[str, int] = {interest: 0 for interest in interests}

    def take_for(interest: str | None) -> dict[str, str] | None:
        for index, fact in enumerate(remaining):
            if interest is None or fact["topic"] == interest:
                return remaining.pop(index)
        return None

    while remaining and len(questions) < PREFERRED_QUESTION_COUNT:
        interest = min(interests, key=lambda item: (used_topics[item], interests.index(item)))
        fact = take_for(interest) or take_for(None)
        if fact is None:
            break
        question = sentence_to_question(fact, pool, len(questions) + 1)
        if question is None:
            continue
        questions.append(question)
        used_topics[question["topic"]] = used_topics.get(question["topic"], 0) + 1

    while remaining and len(questions) < MAX_QUESTION_COUNT and len(questions) < PREFERRED_QUESTION_COUNT:
        fact = remaining.pop(0)
        question = sentence_to_question(fact, pool, len(questions) + 1)
        if question is not None:
            questions.append(question)

    return questions[:MAX_QUESTION_COUNT]


def sentence_to_question(
    fact: dict[str, str],
    span_pool: list[str],
    number: int,
) -> dict[str, Any] | None:
    sentence = fact["sentence"]
    span = pick_answer_span(sentence)
    if not span or span not in sentence:
        return None
    cloze = sentence.replace(span, "_____", 1)
    if "_____" not in cloze:
        return None
    prompt = f"Which option correctly completes this sourced statement? {cloze}"
    distractors = make_distractors(span, span_pool)
    built = make_choices(span, distractors, prompt)
    if built is None:
        return None
    choices, correct_id = built
    correct_text = next(choice["text"] for choice in choices if choice["id"] == correct_id)
    if correct_text not in sentence:
        return None
    return {
        "id": f"q-{number:02d}",
        "prompt": prompt,
        "choices": choices,
        "correct_id": correct_id,
        "topic": fact["topic"],
        "source_id": fact["source_id"],
        "rationale": sentence,
    }


def make_distractors(correct: str, span_pool: list[str]) -> list[str]:
    found: list[str] = []
    seen = {correct.casefold()}
    for other in span_pool:
        key = other.casefold()
        if key in seen:
            continue
        seen.add(key)
        found.append(other)
        if len(found) >= 3:
            return found[:3]
    for candidate in perturb_span(correct):
        key = candidate.casefold()
        if key in seen or not candidate.strip():
            continue
        seen.add(key)
        found.append(candidate)
        if len(found) >= 3:
            break
    return found


def perturb_span(span: str) -> list[str]:
    date_match = DATE_RE.fullmatch(span.strip())
    if date_match:
        year_match = YEAR_RE.search(span)
        if year_match:
            year = int(year_match.group(0))
            return [
                span.replace(str(year), str(year - 1), 1),
                span.replace(str(year), str(year + 1), 1),
                span.replace(str(year), str(year - 5), 1),
            ]
    if PERCENT_RE.fullmatch(span.strip()):
        value = float(span.strip().rstrip("%"))
        alts = [value * 0.5, value + 200, 400.0 if value == 600 else value * 1.5]
        return [format_percent(item, span) for item in alts]
    year_match = YEAR_RE.fullmatch(span.strip())
    if year_match:
        year = int(span.strip())
        return [str(year - 1), str(year + 1), str(year - 5)]
    number = parse_loose_number(span)
    if number is not None:
        alts = [number * 0.8, number * 1.2, number * 0.5 if number else 1]
        return [format_like(span, item) for item in alts]
    return [f"not {span}", f"{span} (approx.)", "none of these figures"]


def format_percent(value: float, original: str) -> str:
    if float(value).is_integer() and "." not in original:
        return f"{int(value)}%"
    return f"{value:g}%"


def parse_loose_number(span: str) -> float | None:
    cleaned = span.replace("$", "").replace(",", "").replace("%", "")
    cleaned = re.sub(r"(trillion|billion|million|percent)", "", cleaned, flags=re.IGNORECASE).strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def format_like(original: str, value: float) -> str:
    prefix = "$" if original.strip().startswith("$") else ""
    suffix = ""
    lowered = original.casefold()
    for word in ("trillion", "billion", "million"):
        if word in lowered:
            suffix = f" {word}"
            break
    if original.endswith("%"):
        suffix = "%"
    if float(value).is_integer() and "." not in original.replace(",", ""):
        body = f"{int(round(value)):,}" if "," in original else str(int(round(value)))
    else:
        body = f"{value:,.2f}" if "," in original else f"{value:.2f}"
    return f"{prefix}{body}{suffix}"


def make_choices(
    correct: str,
    distractors: list[str],
    prompt: str,
) -> tuple[list[dict[str, str]], str] | None:
    unique: list[str] = []
    seen = {correct.casefold()}
    for item in distractors:
        text = item.strip()
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        unique.append(text)
    if len(unique) < 3:
        return None
    slot = sum(ord(char) for char in prompt) % 4
    texts: list[str | None] = [None, None, None, None]
    texts[slot] = correct
    index = 0
    for position in range(4):
        if texts[position] is None:
            texts[position] = unique[index]
            index += 1
    choices = [{"id": CHOICE_IDS[i], "text": str(texts[i])} for i in range(4)]
    return choices, CHOICE_IDS[slot]


def run_recommend_stage(
    args: argparse.Namespace,
    paths: Paths,
    *,
    client: TavilyClient | None,
    preflight: bool,
) -> dict[str, Any]:
    pack = load_json_object(paths.pack_path, label="onboarding pack")
    answers = load_answers(args.answers_json)
    correct, total, level = score_answers(pack, answers)
    interests = pack.get("interests") if isinstance(pack.get("interests"), list) else []
    interests = [str(item) for item in interests if str(item).strip()]
    if not interests:
        raise AgentError("onboarding pack has no interests to recommend from")
    mode = args.mode or "dry-run"
    notes = [str(note) for note in pack.get("style_notes") or [] if str(note).strip()]
    research = pack.get("research") if isinstance(pack.get("research"), dict) else {
        "provider": FIXTURE_PROVIDER if mode != "live" else LIVE_PROVIDER,
        "mode": mode,
        "credits": 0,
        "calls": 0,
        "queries": [],
    }

    if mode == "live":
        recommendations, rec_notes, rec_query, rec_credits = live_recommendations(
            interests,
            level,
            pack,
            paths,
            client=client,
            preflight=preflight,
            timeout_seconds=args.timeout_seconds,
        )
        notes.extend(rec_notes)
        if rec_query is not None:
            queries = list(research.get("queries") or [])
            queries.append(rec_query)
            research["queries"] = queries
            research["credits"] = int(research.get("credits") or 0) + rec_credits
            research["calls"] = int(research.get("calls") or 0) + 1
            research["mode"] = "live"
    else:
        recommendations = templated_recommendations(interests, level)
        notes.append(
            f"{mode.upper()}: recommendations are templated from interests and quiz level; "
            "this pack is not live-researched."
        )
        queries = list(research.get("queries") or [])
        queries.append(
            {
                "pass": "recommend",
                "query": recommend_search_query(interests[0], level),
                "credits": 0,
            }
        )
        research["queries"] = queries

    pack["quiz_score"] = {"correct": correct, "total": total}
    pack["level"] = level
    pack["recommendations"] = recommendations
    pack["research"] = research
    pack["style_notes"] = notes
    pack["slug"] = args.slug or pack.get("slug")

    validate_pack(pack)
    write_json(paths.pack_path, pack)
    patch_learner_profile(
        paths.profile_path,
        status="complete",
        interests=interests,
        goal=str(pack["goal"]) if pack.get("goal") else None,
        quiz_score=pack["quiz_score"],
        level=level,
        recommended_topics=recommendations,
    )
    return pack


def recommend_search_query(interest: str, level: str) -> str:
    return f"{interest} {level} next lesson topics applications prerequisites"


def templated_recommendations(interests: list[str], level: str) -> list[dict[str, str]]:
    templates = REC_TEMPLATES.get(level) or REC_TEMPLATES["beginner"]
    recs: list[dict[str, str]] = []
    variant = 0
    while len(recs) < 3:
        interest = interests[len(recs) % len(interests)]
        topic_tmpl, why_tmpl = templates[variant % len(templates)]
        recs.append(
            {
                "topic": topic_tmpl.format(interest=interest),
                "why": why_tmpl.format(interest=interest),
                "level": level,
            }
        )
        variant += 1
    return recs[:3]


def live_recommendations(
    interests: list[str],
    level: str,
    pack: dict[str, Any],
    paths: Paths,
    *,
    client: TavilyClient | None,
    preflight: bool,
    timeout_seconds: int,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any] | None, int]:
    notes: list[str] = []
    query = recommend_search_query(interests[0], level)
    payload = {
        "query": query,
        "search_depth": "basic",
        "include_usage": True,
    }
    write_json(
        paths.provider_dir / "recommend-request.json",
        {"mode": "live", "endpoint": "/search", "payload": payload},
    )
    tavily = live_client(client=client, preflight=preflight, timeout_seconds=timeout_seconds)
    try:
        response = tavily.search(payload)
        write_json(
            paths.provider_dir / "recommend-response.json",
            sanitize_provider_json(response),
        )
    except AgentError as exc:
        notes.append(
            f"Recommend search failed ({exc}); used interest-templated recommendations."
        )
        rec_query = {"pass": "recommend", "query": query, "credits": 0}
        return templated_recommendations(interests, level), notes, rec_query, 0

    rec_credits = usage_credits(response, 1)
    rec_query = {"pass": "recommend", "query": query, "credits": rec_credits}
    existing = pack.get("sources") if isinstance(pack.get("sources"), list) else []
    accessed_at = utc_date()
    merged_sources = list(existing)
    seen_ids = {str(item.get("id")) for item in existing if isinstance(item, dict)}
    seen_urls = {str(item.get("url")) for item in existing if isinstance(item, dict)}
    for result in search_results(response):
        url = result.get("url")
        if not isinstance(url, str) or url in seen_urls:
            continue
        source_id = unique_source_id(url, str(result.get("title") or ""), seen_ids)
        seen_ids.add(source_id)
        seen_urls.add(url)
        merged_sources.append(
            {
                "id": source_id,
                "title": result.get("title") or title_from_url(url),
                "url": url,
                "publisher": publisher_from_url(url),
                "accessed_at": accessed_at,
            }
        )
    pack["sources"] = merged_sources
    source_by_url = {
        str(item["url"]): str(item["id"])
        for item in merged_sources
        if isinstance(item, dict) and item.get("url") and item.get("id")
    }
    recs = recommendations_from_search(response, level, interests, source_by_url)
    if len(recs) < 3:
        notes.append("Recommend search returned fewer than 3 topics; padded with interest templates.")
        seen_topics = {normalize_topic(item["topic"]) for item in recs}
        for item in templated_recommendations(interests, level):
            if normalize_topic(item["topic"]) in seen_topics:
                continue
            recs.append(item)
            if len(recs) == 3:
                break
    return recs[:3], notes, rec_query, rec_credits


def recommendations_from_search(
    response: dict[str, Any],
    level: str,
    interests: list[str],
    source_by_url: dict[str, str],
) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in search_results(response):
        title = str(result.get("title") or "").strip()
        content = str(result.get("content") or "").strip()
        if not title:
            continue
        key = normalize_topic(title)
        if key in seen:
            continue
        seen.add(key)
        why_source = content or title
        why = clean_claim(next(iter_sentences(why_source), why_source))
        item: dict[str, Any] = {
            "topic": title,
            "why": why or f"Next {level} lesson related to {interests[0]}.",
            "level": level,
        }
        url = result.get("url")
        if isinstance(url, str) and url in source_by_url:
            item["source_id"] = source_by_url[url]
        recs.append(item)
        if len(recs) == 3:
            break
    return recs


def patch_learner_profile(
    path: Path,
    *,
    status: str,
    interests: list[str] | None = None,
    goal: str | None = None,
    quiz_score: dict[str, int] | None = None,
    level: str | None = None,
    recommended_topics: list[dict[str, Any]] | None = None,
) -> None:
    if not path.exists():
        return
    profile = load_json_object(path, label="learner profile")
    profile["updated_at"] = utc_now()
    onboarding = profile.get("onboarding")
    if not isinstance(onboarding, dict):
        onboarding = {}
        profile["onboarding"] = onboarding
    onboarding["status"] = status
    if interests is not None:
        onboarding["interests"] = interests
    if goal:
        onboarding["goal"] = goal
    if quiz_score is not None:
        onboarding["quiz_score"] = quiz_score
    if level is not None:
        onboarding["level"] = level
    if recommended_topics is not None:
        onboarding["recommended_topics"] = [
            {
                key: item[key]
                for key in ("topic", "why", "level", "source_id")
                if key in item
            }
            for item in recommended_topics
        ]
    write_json(path, profile)


if __name__ == "__main__":
    raise SystemExit(main())
