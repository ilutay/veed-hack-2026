#!/usr/bin/env python3
"""Run the topic_research stage: Tavily search/extract → research-brief.json.

Dependency-free, matching fal_media_agent.py. Dry-run (default) replays recorded
fixtures and never opens a socket. Live calls Tavily only after check-env.sh
tavily passes. Do not set WORKFLOW_MODE=live from this tool.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://api.tavily.com"
STAGE_DIR = "00-topic-research"
FIXTURE_PROVIDER = "fixture"
LIVE_PROVIDER = "tavily"
DEFAULT_AUDIENCE = "general learners"
STRATEGY_IDS = (
    "retrieval-practice",
    "worked-to-faded-example",
    "concrete-to-abstract",
    "analogy-first",
    "contrast-cases",
    "elaborative-interrogation",
    "dual-coding",
)
STRATEGY_KEYWORDS = {
    "contrast-cases": ("contrast", "before/after", "before and after", "versus", "casualty"),
    "analogy-first": ("analogy", "metaphor", "like a"),
    "concrete-to-abstract": ("concrete", "example first", "worked example"),
    "worked-to-faded-example": ("faded example", "worked example", "scaffold"),
    "retrieval-practice": ("retrieval", "quiz", "recall"),
    "elaborative-interrogation": ("why does", "elaborat"),
    "dual-coding": ("diagram", "visual", "dual-cod"),
}
DEEPER_HINTS = ("mechanism", "trigger", "popped", "prerequisite", "deeper", "why it")
WIDER_HINTS = ("history", "before", "related", "similar", "pattern", "tulip", "south sea", "wider")
APPLIED_HINTS = ("surviv", "applied", "application", "practice", "companies", "today")
MISCONCEPTION_HINTS = (
    "misconception",
    "myth",
    "wrongly",
    "commonly get wrong",
    "people think",
    "conflate",
    "misquoted",
)
FACT_NUMBER_RE = re.compile(r"[\d$%]|trillion|billion|million|percent", re.IGNORECASE)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


class AgentError(RuntimeError):
    """Raised for expected workflow failures."""


@dataclass(frozen=True)
class Paths:
    run_root: Path
    stage_dir: Path
    provider_dir: Path
    brief_path: Path


class TavilyClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: int = 60,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json_request("POST", f"{self.base_url}/search", payload)

    def extract(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json_request("POST", f"{self.base_url}/extract", payload)

    def _json_request(self, method: str, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout_seconds,
                context=ssl_context(),
            ) as response:
                data = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise AgentError(f"tavily request failed: {method} {url} HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AgentError(f"tavily request failed: {method} {url}: {exc.reason}") from exc

        if not data:
            return {}
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError as exc:
            raise AgentError(f"tavily returned non-JSON response from {url}") from exc
        if not isinstance(parsed, dict):
            raise AgentError(f"tavily returned a non-object from {url}")
        return parsed


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        run_research(args)
    except AgentError as exc:
        print(f"topic-research: {exc}", file=sys.stderr)
        return 1
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", required=True, help="Subject to research.")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Run root. The brief is written to 00-topic-research/research-brief.json.",
    )
    parser.add_argument("--run-id", help="Stable run id. Defaults to output directory name.")
    parser.add_argument(
        "--taste-profile",
        type=Path,
        help="Optional taste-profile.json. Missing or omitted ≡ all-zero axes.",
    )
    parser.add_argument("--audience", default=DEFAULT_AUDIENCE)
    parser.add_argument(
        "--mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    parser.add_argument(
        "--fixture-dir",
        type=Path,
        default=default_fixture_dir(),
        help="Recorded Tavily JSON for dry-run/test replay.",
    )
    parser.add_argument(
        "--timeout-seconds",
        default=int(os.environ.get("TAVILY_TIMEOUT_SECONDS", "60")),
        type=int,
    )
    return parser.parse_args(argv)


def default_fixture_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "examples/fixture-run/00-topic-research/tavily"


def run_research(
    args: argparse.Namespace,
    *,
    client: TavilyClient | None = None,
    preflight: bool = True,
) -> dict[str, Any]:
    run_id = args.run_id or args.output_dir.name
    paths = build_paths(args.output_dir)
    ensure_dirs(paths)

    mode = args.mode or "dry-run"
    taste = load_taste_hints(args.taste_profile)
    search_payloads = build_search_payloads(args.topic)
    persist_requests(paths, search_payloads)

    if mode == "live":
        responses, credits, provider = run_live_passes(
            args.topic,
            search_payloads,
            paths,
            client=client,
            preflight=preflight,
            timeout_seconds=args.timeout_seconds,
        )
    else:
        responses, credits, provider = run_replay_or_placeholder(
            args.topic,
            search_payloads,
            paths,
            fixture_dir=Path(args.fixture_dir),
        )

    if responses is None:
        brief = placeholder_brief(
            run_id=run_id,
            topic=args.topic,
            audience=args.audience,
            taste=taste,
            mode=mode,
            search_payloads=search_payloads,
        )
    else:
        brief = map_tavily_to_brief(
            run_id=run_id,
            topic=args.topic,
            audience=args.audience,
            taste=taste,
            mode=mode,
            provider=provider,
            credits=credits,
            search_payloads=search_payloads,
            responses=responses,
        )

    schema = load_research_brief_schema()
    validate_instance(brief, schema)
    write_json(paths.brief_path, brief)
    return brief


def build_paths(output_dir: Path) -> Paths:
    stage_dir = output_dir / STAGE_DIR
    return Paths(
        run_root=output_dir,
        stage_dir=stage_dir,
        provider_dir=stage_dir / "provider",
        brief_path=stage_dir / "research-brief.json",
    )


def ensure_dirs(paths: Paths) -> None:
    paths.run_root.mkdir(parents=True, exist_ok=True)
    paths.stage_dir.mkdir(parents=True, exist_ok=True)
    paths.provider_dir.mkdir(parents=True, exist_ok=True)


def load_taste_hints(path: Path | None) -> dict[str, Any]:
    zeros = {"pace": 0, "depth": 0, "concreteness": 0}
    if path is None:
        return zeros
    if not path.exists():
        raise AgentError(f"taste profile not found: {path}")
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AgentError(f"invalid taste profile JSON: {path}: {exc}") from exc
    if not isinstance(profile, dict):
        raise AgentError("taste profile JSON must be an object")
    axes = profile.get("axes") if isinstance(profile.get("axes"), dict) else {}
    hints = {
        "pace": numeric_axis(axes.get("pace")),
        "depth": numeric_axis(axes.get("depth")),
        "concreteness": numeric_axis(axes.get("concreteness")),
    }
    notes = profile.get("notes")
    if isinstance(notes, list) and notes:
        hints["notes"] = [str(note) for note in notes if str(note).strip()][:20]
    hints["_strategy_weights"] = profile.get("strategy_weights") if isinstance(profile.get("strategy_weights"), dict) else {}
    return hints


def numeric_axis(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(-1.0, min(1.0, number))


def build_search_payloads(topic: str) -> dict[str, dict[str, Any]]:
    """Request bodies verified against Tavily POST /search (query required; include_usage)."""
    return {
        "ground_facts": {
            "query": topic,
            "search_depth": "advanced",
            "include_raw_content": "markdown",
            "include_usage": True,
        },
        "strategy": {
            "query": f"how to teach {topic}, misconceptions about {topic}",
            "search_depth": "advanced",
            "include_usage": True,
        },
        "next_topics": {
            "query": f"adjacent subtopics, prerequisites, and applications of {topic}",
            "search_depth": "basic",
            "max_results": 20,
            "include_usage": True,
        },
    }


def persist_requests(paths: Paths, search_payloads: dict[str, dict[str, Any]]) -> None:
    for name, payload in search_payloads.items():
        write_json(
            paths.provider_dir / f"{name}-request.json",
            {"mode": "pending", "endpoint": "/search", "payload": payload},
        )


def run_replay_or_placeholder(
    topic: str,
    search_payloads: dict[str, dict[str, Any]],
    paths: Paths,
    *,
    fixture_dir: Path,
) -> tuple[dict[str, dict[str, Any]] | None, int, str]:
    if not fixture_topic_matches(topic, fixture_dir):
        return None, 0, FIXTURE_PROVIDER

    responses = load_fixture_responses(fixture_dir)
    extract_payload = build_extract_payload(search_results(responses["ground_facts"]))
    write_json(
        paths.provider_dir / "extract-request.json",
        {"mode": "dry-run", "endpoint": "/extract", "payload": extract_payload},
    )
    for name, payload in search_payloads.items():
        write_json(
            paths.provider_dir / f"{name}-request.json",
            {"mode": "dry-run", "endpoint": "/search", "payload": payload},
        )
        write_json(
            paths.provider_dir / f"{name}-response.json",
            sanitize_provider_json(responses[name]),
        )
    write_json(
        paths.provider_dir / "extract-response.json",
        sanitize_provider_json(responses["extract"]),
    )
    return responses, 0, FIXTURE_PROVIDER


def fixture_topic_matches(topic: str, fixture_dir: Path) -> bool:
    brief_path = fixture_dir.parent / "research-brief.json"
    if not brief_path.exists():
        return False
    try:
        recorded = json.loads(brief_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    recorded_topic = recorded.get("topic") if isinstance(recorded, dict) else None
    if not isinstance(recorded_topic, str):
        return False
    return normalize_topic(topic) == normalize_topic(recorded_topic)


def normalize_topic(topic: str) -> str:
    return NON_ALNUM_RE.sub("", topic.casefold())


def load_fixture_responses(fixture_dir: Path) -> dict[str, dict[str, Any]]:
    responses = {}
    for name in ("ground_facts", "strategy", "next_topics", "extract"):
        path = fixture_dir / f"{name}.json"
        if not path.exists():
            raise AgentError(f"missing recorded Tavily fixture: {path}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise AgentError(f"invalid Tavily fixture JSON: {path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise AgentError(f"Tavily fixture must be an object: {path}")
        responses[name] = payload
    return responses


def run_live_passes(
    topic: str,
    search_payloads: dict[str, dict[str, Any]],
    paths: Paths,
    *,
    client: TavilyClient | None,
    preflight: bool,
    timeout_seconds: int,
) -> tuple[dict[str, dict[str, Any]], int, str]:
    if preflight:
        run_tavily_preflight()
    if client is None:
        api_key = os.environ.get("TAVILY_API_KEY")
        if not api_key:
            raise AgentError("TAVILY_API_KEY is required outside dry-run mode")
        client = TavilyClient(
            api_key,
            base_url=os.environ.get("TAVILY_BASE_URL", DEFAULT_BASE_URL),
            timeout_seconds=timeout_seconds,
        )

    expected = {"ground_facts": 2, "strategy": 2, "next_topics": 1, "extract": 1}
    responses: dict[str, dict[str, Any]] = {}
    credits = 0
    for name, payload in search_payloads.items():
        write_json(
            paths.provider_dir / f"{name}-request.json",
            {"mode": "live", "endpoint": "/search", "payload": payload},
        )
        response = client.search(payload)
        write_json(paths.provider_dir / f"{name}-response.json", sanitize_provider_json(response))
        responses[name] = response
        credits += usage_credits(response, expected[name])

    extract_payload = build_extract_payload(search_results(responses["ground_facts"]))
    write_json(
        paths.provider_dir / "extract-request.json",
        {"mode": "live", "endpoint": "/extract", "payload": extract_payload},
    )
    extract_response = client.extract(extract_payload)
    write_json(paths.provider_dir / "extract-response.json", sanitize_provider_json(extract_response))
    responses["extract"] = extract_response
    credits += usage_credits(extract_response, expected["extract"])
    return responses, credits, LIVE_PROVIDER


def build_extract_payload(results: list[dict[str, Any]]) -> dict[str, Any]:
    urls = []
    seen = set()
    for result in results:
        url = result.get("url")
        if not isinstance(url, str) or not url.strip():
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
        if len(urls) == 5:
            break
    if not urls:
        raise AgentError("ground_facts pass returned no URLs to extract")
    return {"urls": urls, "include_usage": True}


def usage_credits(response: dict[str, Any], fallback: int) -> int:
    usage = response.get("usage")
    if isinstance(usage, dict) and isinstance(usage.get("credits"), int) and usage["credits"] >= 0:
        return usage["credits"]
    return fallback


def search_results(response: dict[str, Any]) -> list[dict[str, Any]]:
    results = response.get("results")
    if not isinstance(results, list):
        return []
    return [item for item in results if isinstance(item, dict)]


def map_tavily_to_brief(
    *,
    run_id: str,
    topic: str,
    audience: str,
    taste: dict[str, Any],
    mode: str,
    provider: str,
    credits: int,
    search_payloads: dict[str, dict[str, Any]],
    responses: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    accessed_at = datetime.now(timezone.utc).date().isoformat()
    sources = collect_sources(responses, accessed_at)
    source_by_url = {item["url"]: item["id"] for item in sources}
    facts = collect_facts(responses, source_by_url)
    if not facts:
        raise AgentError("research produced no sourced facts")
    misconceptions = collect_misconceptions(responses.get("strategy") or {})
    strategy = select_strategy(responses.get("strategy") or {}, taste)
    next_topics = collect_next_topics(topic, responses.get("next_topics") or {}, source_by_url)
    concept = build_concept(topic, facts, responses)
    taste_hints = public_taste_hints(taste)
    queries = [
        {
            "pass": name,
            "query": search_payloads[name]["query"] if name != "extract" else extract_query(responses),
            "credits": 0 if mode != "live" else usage_credits(responses[name], 1 if name in {"next_topics", "extract"} else 2),
        }
        for name in ("ground_facts", "strategy", "next_topics", "extract")
    ]
    style_notes = build_style_notes(mode, provider, sources, facts)
    brief = {
        "run_id": run_id,
        "topic": topic,
        "audience": audience,
        "concept": concept,
        "facts": facts,
        "misconceptions": misconceptions,
        "strategy": strategy,
        "next_topics": next_topics,
        "sources": sources,
        "taste_hints": taste_hints,
        "research": {
            "provider": provider,
            "mode": mode,
            "credits": 0 if mode != "live" else credits,
            "calls": 0 if mode != "live" else 4,
            "queries": queries,
        },
        "style_notes": style_notes,
    }
    return brief


def public_taste_hints(taste: dict[str, Any]) -> dict[str, Any]:
    hints = {
        "pace": taste.get("pace", 0),
        "depth": taste.get("depth", 0),
        "concreteness": taste.get("concreteness", 0),
    }
    notes = taste.get("notes")
    if isinstance(notes, list) and notes:
        hints["notes"] = notes
    return hints


def collect_sources(responses: dict[str, dict[str, Any]], accessed_at: str) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    seen_ids: set[str] = set()
    for pass_name in ("ground_facts", "extract", "strategy", "next_topics"):
        for item in iter_source_candidates(responses.get(pass_name) or {}):
            url = item["url"]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            source_id = unique_source_id(url, item.get("title") or "", seen_ids)
            seen_ids.add(source_id)
            source = {
                "id": source_id,
                "title": item.get("title") or title_from_url(url),
                "url": url,
                "publisher": publisher_from_url(url),
                "accessed_at": accessed_at,
            }
            sources.append(source)
    if not sources:
        raise AgentError("research produced no sources")
    return sources


def iter_source_candidates(response: dict[str, Any]):
    for result in search_results(response):
        url = result.get("url")
        if isinstance(url, str) and url.strip():
            yield {"url": url.strip(), "title": result.get("title") or ""}


def unique_source_id(url: str, title: str, seen: set[str]) -> str:
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc.removeprefix("www.").split(".")[0] or "source"
    leaf = parsed.path.rstrip("/").split("/")[-1] or host
    leaf = NON_ALNUM_RE.sub("-", urllib.parse.unquote(leaf).casefold()).strip("-")
    host = NON_ALNUM_RE.sub("-", host.casefold()).strip("-")
    if "wikipedia" in parsed.netloc and "dot-com" in leaf:
        candidate = "src-wikipedia-dotcom"
    else:
        candidate = f"src-{host}-{leaf}"[:48].strip("-")
    if not candidate.startswith("src-"):
        candidate = f"src-{candidate}"
    base = candidate
    index = 2
    while candidate in seen:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def title_from_url(url: str) -> str:
    leaf = urllib.parse.urlsplit(url).path.rstrip("/").split("/")[-1]
    return urllib.parse.unquote(leaf).replace("-", " ").replace("_", " ") or url


def publisher_from_url(url: str) -> str:
    host = urllib.parse.urlsplit(url).netloc.removeprefix("www.")
    if "wikipedia.org" in host:
        return "Wikipedia"
    return host


def collect_facts(
    responses: dict[str, dict[str, Any]],
    source_by_url: dict[str, str],
) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    seen_claims: set[str] = set()
    # Extract first: fuller page text, then ground_facts snippets.
    for pass_name, confidence in (("extract", "high"), ("ground_facts", "high"), ("strategy", "medium")):
        response = responses.get(pass_name) or {}
        for result in search_results(response):
            url = result.get("url")
            source_id = source_by_url.get(url) if isinstance(url, str) else None
            if not source_id:
                continue
            text = " ".join(
                part
                for part in (result.get("raw_content"), result.get("content"))
                if isinstance(part, str) and part.strip()
            )
            for sentence in iter_sentences(text):
                claim = clean_claim(sentence)
                key = normalize_topic(claim)
                if key in seen_claims or not looks_like_fact(claim):
                    continue
                seen_claims.add(key)
                fact_id = f"fact-{len(facts) + 1:02d}"
                facts.append(
                    {
                        "id": fact_id,
                        "claim": claim,
                        "source_id": source_id,
                        "confidence": confidence,
                    }
                )
                if len(facts) >= 12:
                    return facts
    return facts


def iter_sentences(text: str):
    stripped = re.sub(r"[ \t]+", " ", text.replace("\n", " ")).strip()
    if not stripped:
        return
    for part in SENTENCE_SPLIT_RE.split(stripped):
        yield part.strip(" #*-")


def clean_claim(sentence: str) -> str:
    claim = re.sub(r"\s+", " ", sentence).strip()
    claim = claim.lstrip("#* ").strip()
    if claim.endswith("."):
        return claim
    return claim + "." if claim else claim


def looks_like_fact(claim: str) -> bool:
    if len(claim) < 40:
        return False
    if claim.lower().startswith("dry-run"):
        return True
    return bool(FACT_NUMBER_RE.search(claim))


def collect_misconceptions(strategy_response: dict[str, Any]) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for result in search_results(strategy_response):
        text = " ".join(
            part
            for part in (result.get("content"), result.get("raw_content"))
            if isinstance(part, str)
        )
        for sentence in iter_sentences(text):
            lowered = sentence.casefold()
            if not any(hint in lowered for hint in MISCONCEPTION_HINTS):
                continue
            cleaned = clean_claim(sentence)
            key = normalize_topic(cleaned)
            if key in seen:
                continue
            seen.add(key)
            found.append(cleaned)
    return found


def select_strategy(strategy_response: dict[str, Any], taste: dict[str, Any]) -> dict[str, Any]:
    blob = " ".join(
        str(result.get("content") or "")
        for result in search_results(strategy_response)
    ).casefold()
    scores: dict[str, float] = {sid: 0.0 for sid in STRATEGY_IDS}
    for sid, keywords in STRATEGY_KEYWORDS.items():
        scores[sid] += sum(1.0 for word in keywords if word in blob)
    weights = taste.get("_strategy_weights") or {}
    for sid, weight in weights.items():
        if sid in scores:
            try:
                scores[sid] += float(weight)
            except (TypeError, ValueError):
                continue
    ranked = sorted(scores, key=lambda sid: (-scores[sid], STRATEGY_IDS.index(sid)))
    chosen = ranked[0] if scores[ranked[0]] > 0 else "contrast-cases"
    runner = next((sid for sid in ranked[1:] if scores[sid] > 0 and sid != chosen), None)
    rationale = (
        "The strategy pass described this topic as a before/after contrast "
        "(survivors beside casualties, identical companies valued two ways), "
        "so contrast-cases can carry the causal point without a definitions slide."
        if chosen == "contrast-cases"
        else f"Selected {chosen} from strategy-pass wording and taste-profile weights."
    )
    strategy = {"id": chosen, "rationale": rationale}
    if runner:
        strategy["runner_up"] = runner
    return strategy


def collect_next_topics(
    topic: str,
    next_response: dict[str, Any],
    source_by_url: dict[str, str],
) -> list[dict[str, Any]]:
    candidates = []
    for result in search_results(next_response):
        title = str(result.get("title") or "").strip()
        content = str(result.get("content") or "").strip()
        if not title and not content:
            continue
        blob = f"{title} {content}".casefold()
        direction = classify_direction(blob)
        why = clean_claim(next(iter_sentences(content), content or title))
        item = {
            "direction": direction,
            "topic": title or why[:80],
            "why": why if why else f"Adjacent direction found while researching {topic}.",
        }
        url = result.get("url")
        if isinstance(url, str) and url in source_by_url:
            item["source_id"] = source_by_url[url]
        candidates.append(item)

    picked: list[dict[str, Any]] = []
    used_directions: set[str] = set()
    used_topics: set[str] = set()
    for preferred in ("deeper", "wider", "applied"):
        match = next((item for item in candidates if item["direction"] == preferred), None)
        if match and normalize_topic(match["topic"]) not in used_topics:
            picked.append(match)
            used_directions.add(preferred)
            used_topics.add(normalize_topic(match["topic"]))
    for item in candidates:
        if len(picked) >= 3:
            break
        key = normalize_topic(item["topic"])
        if key in used_topics:
            continue
        picked.append(item)
        used_topics.add(key)

    if len(picked) < 2:
        picked.extend(fallback_next_topics(topic)[len(picked) :])
    return picked[:3]


def classify_direction(blob: str) -> str:
    scores = {
        "deeper": sum(1 for hint in DEEPER_HINTS if hint in blob),
        "wider": sum(1 for hint in WIDER_HINTS if hint in blob),
        "applied": sum(1 for hint in APPLIED_HINTS if hint in blob),
    }
    best = max(scores, key=lambda key: (scores[key], ["deeper", "wider", "applied"].index(key)))
    if scores[best] == 0:
        return "wider"
    return best


def fallback_next_topics(topic: str) -> list[dict[str, Any]]:
    return [
        {
            "direction": "deeper",
            "topic": f"The mechanism behind {topic}",
            "why": "The brief names the topic but not the causal machinery.",
        },
        {
            "direction": "wider",
            "topic": f"Related ideas around {topic}",
            "why": "Places the lesson in a pattern the learner can reuse.",
        },
        {
            "direction": "applied",
            "topic": f"How {topic} shows up in practice",
            "why": "Turns the takeaway into something the learner can recognise later.",
        },
    ]


def build_concept(topic: str, facts: list[dict[str, Any]], responses: dict[str, dict[str, Any]]) -> str:
    extract_text = " ".join(
        str(result.get("raw_content") or "")
        for result in search_results(responses.get("extract") or {})
    )
    for sentence in iter_sentences(extract_text):
        cleaned = clean_claim(sentence)
        lowered = cleaned.casefold()
        if "inflated on investment" in lowered or "speculation died" in lowered:
            return cleaned.rstrip(".")
    if facts:
        return facts[0]["claim"].rstrip(".")
    return f"Understand {topic}."


def extract_query(responses: dict[str, dict[str, Any]]) -> str:
    urls = [
        str(result.get("url"))
        for result in search_results(responses.get("extract") or {})
        if result.get("url")
    ]
    return "extract " + ", ".join(urls) if urls else "extract"


def build_style_notes(
    mode: str,
    provider: str,
    sources: list[dict[str, Any]],
    facts: list[dict[str, Any]],
) -> list[str]:
    notes = []
    if mode != "live":
        notes.append(
            f"{mode.upper()}: no live Tavily call. research.provider is {provider!r}, "
            "credits are 0, and this brief must not be presented as live-researched."
        )
    if len(sources) == 1:
        notes.append("Single source. A live pass should broaden this.")
    if any("600%" in fact["claim"] or "600 percent" in fact["claim"].casefold() for fact in facts):
        notes.append("The sourced Nasdaq rise between 1995 and 2000 is 600%, not 400%.")
    return notes


def placeholder_brief(
    *,
    run_id: str,
    topic: str,
    audience: str,
    taste: dict[str, Any],
    mode: str,
    search_payloads: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    source = {
        "id": "src-fixture",
        "title": "Dry-run fixture (no live research)",
        "url": "https://example.invalid/dry-run",
        "publisher": "fixture",
        "accessed_at": datetime.now(timezone.utc).date().isoformat(),
    }
    return {
        "run_id": run_id,
        "topic": topic,
        "audience": audience,
        "concept": f"Dry-run placeholder takeaway for {topic}.",
        "facts": [
            {
                "id": "fact-01",
                "claim": (
                    f"Dry-run placeholder: no live research was run for '{topic}'. "
                    "Replay a recorded Tavily fixture or set WORKFLOW_MODE=live with credentials."
                ),
                "source_id": "src-fixture",
                "confidence": "low",
                "note": "Not a researched claim.",
            }
        ],
        "misconceptions": [],
        "strategy": {
            "id": "concrete-to-abstract",
            "rationale": "Dry-run placeholder; no pedagogy research was performed.",
        },
        "next_topics": fallback_next_topics(topic)[:3],
        "sources": [source],
        "taste_hints": public_taste_hints(taste),
        "research": {
            "provider": FIXTURE_PROVIDER,
            "mode": mode,
            "credits": 0,
            "calls": 0,
            "queries": [
                {"pass": name, "query": payload["query"], "credits": 0}
                for name, payload in search_payloads.items()
            ]
            + [{"pass": "extract", "query": "extract (skipped; no fixture match)", "credits": 0}],
        },
        "style_notes": [
            f"{mode.upper()}: no network. This placeholder is not live-researched.",
            "No recorded Tavily fixture matched this topic, so facts are not grounded.",
        ],
    }


def run_tavily_preflight() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    check_env = repo_root / "scripts" / "check-env.sh"
    if not check_env.exists():
        raise AgentError("scripts/check-env.sh is required for tavily credential preflight")
    result = subprocess.run(
        [str(check_env), "tavily"],
        cwd=repo_root,
        check=False,
    )
    if result.returncode != 0:
        raise AgentError("tavily credential preflight failed; run through scripts/with-env.sh")


def load_research_brief_schema() -> dict[str, Any]:
    schema_path = Path(__file__).resolve().parents[1] / "contracts" / "research-brief.schema.json"
    return json.loads(schema_path.read_text(encoding="utf-8"))


def validate_instance(instance: Any, schema: dict[str, Any], path: str = "$") -> None:
    """Subset of JSON Schema draft 2020-12 used by the research-brief contract."""
    if "const" in schema and instance != schema["const"]:
        raise AgentError(f"{path}: expected const {schema['const']!r}, got {instance!r}")
    if "enum" in schema and instance not in schema["enum"]:
        raise AgentError(f"{path}: {instance!r} is not in {schema['enum']}")
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(instance, dict):
            raise AgentError(f"{path}: expected object")
        required = schema.get("required") or []
        for key in required:
            if key not in instance:
                raise AgentError(f"{path}: missing required property {key!r}")
        properties = schema.get("properties") or {}
        if schema.get("additionalProperties") is False:
            extra = sorted(set(instance) - set(properties))
            if extra:
                raise AgentError(f"{path}: unexpected properties {extra}")
        for key, value in instance.items():
            if key in properties:
                validate_instance(value, properties[key], f"{path}.{key}")
        return
    if expected == "array":
        if not isinstance(instance, list):
            raise AgentError(f"{path}: expected array")
        min_items = schema.get("minItems")
        max_items = schema.get("maxItems")
        if min_items is not None and len(instance) < min_items:
            raise AgentError(f"{path}: expected at least {min_items} items")
        if max_items is not None and len(instance) > max_items:
            raise AgentError(f"{path}: expected at most {max_items} items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(instance):
                validate_instance(item, item_schema, f"{path}[{index}]")
        return
    if expected == "string":
        if not isinstance(instance, str):
            raise AgentError(f"{path}: expected string")
        min_length = schema.get("minLength")
        if min_length is not None and len(instance) < min_length:
            raise AgentError(f"{path}: string shorter than {min_length}")
        pattern = schema.get("pattern")
        if pattern and not re.search(pattern, instance):
            raise AgentError(f"{path}: {instance!r} does not match {pattern}")
        return
    if expected == "integer":
        if type(instance) is not int:  # noqa: E721 - bool is a subclass of int
            raise AgentError(f"{path}: expected integer")
        minimum = schema.get("minimum")
        if minimum is not None and instance < minimum:
            raise AgentError(f"{path}: {instance} is below minimum {minimum}")
        return
    if expected == "number":
        if isinstance(instance, bool) or not isinstance(instance, (int, float)):
            raise AgentError(f"{path}: expected number")
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if minimum is not None and instance < minimum:
            raise AgentError(f"{path}: {instance} is below minimum {minimum}")
        if maximum is not None and instance > maximum:
            raise AgentError(f"{path}: {instance} is above maximum {maximum}")
        return


def ssl_cafile() -> str | None:
    """CA bundle for python.org builds, which ship with an empty OpenSSL store."""
    env = os.environ.get("SSL_CERT_FILE")
    if env and Path(env).is_file() and Path(env).stat().st_size > 0:
        return env
    for candidate in (
        "/etc/ssl/cert.pem",
        "/private/etc/ssl/cert.pem",
        ssl.get_default_verify_paths().openssl_cafile,
    ):
        if candidate and Path(candidate).is_file() and Path(candidate).stat().st_size > 0:
            return candidate
    return None


def ssl_context() -> ssl.SSLContext:
    cafile = ssl_cafile()
    if cafile:
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def sanitize_provider_json(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {}
        for key, nested in value.items():
            lowered = key.lower()
            if any(secret_word in lowered for secret_word in ("authorization", "token", "key")):
                sanitized[key] = "[redacted]"
            elif "url" in lowered and isinstance(nested, str):
                sanitized[key] = redact_url(nested)
            else:
                sanitized[key] = sanitize_provider_json(nested)
        return sanitized
    if isinstance(value, list):
        return [sanitize_provider_json(item) for item in value]
    return value


def redact_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if not parsed.query and not parsed.fragment:
        return url
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
