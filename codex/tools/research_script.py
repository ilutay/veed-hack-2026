#!/usr/bin/env python3
"""Turn research-brief.json into lesson-script.json. No web research."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

CHROME_RE = re.compile(
    r"skip to|jump to|main menu|main content|edit this|retrieved from|"
    r"wikipedia, the free encyclopedia|cookie|subscribe to",
    re.IGNORECASE,
)
WORD_RE = re.compile(r"\S+")


class AgentError(RuntimeError):
    pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--brief", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path, help="lesson-script.json path")
    return p.parse_args(argv)


def load_brief(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AgentError(f"cannot read brief: {exc}") from exc
    if not isinstance(data, dict):
        raise AgentError("brief is not an object")
    return data


def is_chrome(claim: str) -> bool:
    if len(claim) > 280:
        return True
    return bool(CHROME_RE.search(claim))


def usable_facts(brief: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for fact in brief.get("facts") or []:
        if not isinstance(fact, dict):
            continue
        claim = str(fact.get("claim") or "").strip()
        source_id = str(fact.get("source_id") or "").strip()
        if not claim or not source_id:
            continue
        if is_chrome(claim):
            continue
        out.append(fact)
    return out


def clip_narration(claim: str, limit: int = 14) -> str:
    words = WORD_RE.findall(claim.rstrip(" ."))
    if len(words) <= limit:
        return claim.rstrip() if claim.endswith(".") else claim.rstrip() + "."
    cut = " ".join(words[:limit]).rstrip(",;:")
    return cut + "."


def title_from_claim(claim: str) -> str:
    first = re.split(r"[.!?]", claim, maxsplit=1)[0].strip()
    words = WORD_RE.findall(first)
    if len(words) <= 7:
        return first
    return " ".join(words[:7])


def durations(n: int) -> list[int]:
    if n == 5:
        return [3, 3, 3, 3, 3]
    if n == 6:
        return [3, 3, 2, 2, 3, 2]
    raise AgentError(f"need 5 or 6 slides, got {n}")


def pad_facts(facts: list[dict[str, Any]], brief: dict[str, Any]) -> list[dict[str, Any]]:
    if len(facts) >= 5:
        return facts[:6]
    concept = str(brief.get("concept") or "").strip()
    source_id = facts[0]["source_id"] if facts else None
    if not source_id:
        sources = brief.get("sources") or []
        if sources and isinstance(sources[0], dict):
            source_id = sources[0].get("id")
    if not source_id:
        raise AgentError("no sourced facts to build a script from")
    padded = list(facts)
    if concept and not any(concept == f.get("claim") for f in padded):
        padded.insert(
            0,
            {
                "id": "fact-concept",
                "claim": concept,
                "source_id": source_id,
                "confidence": "medium",
            },
        )
    for mis in brief.get("misconceptions") or []:
        if len(padded) >= 5:
            break
        text = str(mis).strip()
        if not text or is_chrome(text):
            continue
        padded.append(
            {
                "id": f"fact-mis-{len(padded):02d}",
                "claim": text,
                "source_id": source_id,
                "confidence": "medium",
            }
        )
    while len(padded) < 5:
        padded.append(
            {
                "id": f"fact-pad-{len(padded):02d}",
                "claim": concept or str(brief.get("topic") or "This lesson"),
                "source_id": source_id,
                "confidence": "low",
            }
        )
    return padded[:6]


def build_script(brief: dict[str, Any]) -> dict[str, Any]:
    topic = str(brief.get("topic") or "").strip() or "Untitled"
    concept = str(brief.get("concept") or topic).strip()
    audience = str(brief.get("audience") or "general learners").strip()
    facts = pad_facts(usable_facts(brief), brief)
    durs = durations(len(facts))
    slides = []
    for i, (fact, dur) in enumerate(zip(facts, durs), start=1):
        claim = str(fact["claim"]).strip()
        slides.append(
            {
                "id": f"slide-{i:02d}",
                "title": title_from_claim(claim),
                "key_points": [clip_narration(claim, 6).rstrip(".")],
                "narration": clip_narration(claim),
                "visual_brief": (
                    "Risograph print illustration, two spot inks, one clear subject: "
                    f"{title_from_claim(claim).lower()}. No text in the image."
                ),
                "duration_seconds": dur,
                "source_ids": [fact["source_id"]],
            }
        )

    labels = ("A", "B", "C")
    next_topics = brief.get("next_topics") or []
    next_video = []
    for i, item in enumerate(next_topics[:3]):
        if not isinstance(item, dict):
            continue
        direction = str(item.get("topic") or item.get("direction") or "").strip()
        if not direction:
            continue
        next_video.append({"label": labels[i], "direction": direction})
    if len(next_video) < 2:
        next_video = [
            {"label": "A", "direction": f"Go deeper on {topic}"},
            {"label": "B", "direction": f"A wider view of {topic}"},
        ]

    sources = []
    for src in brief.get("sources") or []:
        if not isinstance(src, dict):
            continue
        entry = {
            "id": src.get("id"),
            "title": src.get("title"),
            "url": src.get("url"),
        }
        if src.get("publisher"):
            entry["publisher"] = src["publisher"]
        if src.get("accessed_at"):
            entry["accessed_at"] = src["accessed_at"]
        if entry["id"] and entry["title"] and entry["url"]:
            sources.append(entry)

    notes = list(brief.get("style_notes") or [])
    research = brief.get("research") or {}
    if research.get("mode") in ("dry-run", "test"):
        notes.append(
            f"research.mode is {research.get('mode')} — this script is not live-researched."
        )
    notes.append("research_script mapped facts to slides; it did not search the web.")

    return {
        "topic": topic,
        "title": topic if len(topic) < 60 else title_from_claim(topic),
        "learning_objective": concept,
        "audience": audience,
        "duration_seconds": 15,
        "style_notes": notes,
        "slides": slides,
        "next_video": next_video,
        "sources": sources,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        brief = load_brief(args.brief)
        script = build_script(brief)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(script, indent=2) + "\n", encoding="utf-8")
        stage = args.output.parent / "01-research-script"
        if args.output.parent.name != "01-research-script":
            stage.mkdir(parents=True, exist_ok=True)
            (stage / "lesson-script.json").write_text(
                json.dumps(script, indent=2) + "\n", encoding="utf-8"
            )
    except AgentError as exc:
        print(f"research-script: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
