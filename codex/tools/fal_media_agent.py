#!/usr/bin/env python3
"""Generate slide images and lesson voiceover through fal.ai.

The CLI is intentionally dependency-free so the workflow scaffold can run in a
fresh checkout. In dry-run mode it emits the exact payloads and deterministic
artifact paths without making network calls.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


IMAGE_ENDPOINT = "fal-ai/z-image/turbo"
VOICE_ENDPOINT = "fal-ai/minimax/speech-2.6-turbo"
VOICE_TEXT_LIMIT = 5000
LANGUAGE_BOOSTS = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "ru": "Russian",
    "uk": "Ukrainian",
    "pl": "Polish",
    "tr": "Turkish",
    "ar": "Arabic",
    "hi": "Hindi",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
}
DEFAULT_ART_DIRECTION = (
    "Clean educational editorial illustration; concrete diagrams and visual "
    "metaphors over decorative backgrounds; consistent palette; no tiny labels "
    "or paragraphs inside the generated image; leave open space for webpage "
    "title and caption overlays."
)
NEGATIVE_IMAGE_GUIDANCE = (
    "Avoid dense text, UI screenshots, tiny labels, misleading scientific "
    "diagrams, watermarks, logos, distorted hands, and cluttered backgrounds."
)
FIELD_RE = re.compile(
    r"^\s*(narration|script|voiceover|visual(?:\s+brief)?|image|key\s+points?|duration)\s*:\s*(.*)$",
    re.IGNORECASE,
)
SLIDE_HEADING_RE = re.compile(
    r"^\s{0,3}(?:#{1,4}\s*)?slide\s*(\d{1,2})\s*[:.\-]\s*(.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


class AgentError(RuntimeError):
    """Raised for expected workflow failures."""


@dataclass(frozen=True)
class Paths:
    run_root: Path
    content_dir: Path
    provider_dir: Path
    slide_image_dir: Path
    manifest_path: Path
    lesson_script_path: Path


class FalQueueClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://queue.fal.run",
        timeout_seconds: int = 30,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def submit(self, endpoint_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json_request(
            "POST",
            f"{self.base_url}/{endpoint_id.lstrip('/')}",
            payload,
        )

    def status(self, status_url: str) -> dict[str, Any]:
        separator = "&" if "?" in status_url else "?"
        return self._json_request("GET", f"{status_url}{separator}logs=1", None)

    def result(self, response_url: str) -> dict[str, Any]:
        return self._json_request("GET", response_url, None)

    def download(self, url: str, output_path: Path) -> None:
        request = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                output_path.write_bytes(response.read())
        except urllib.error.HTTPError as exc:
            raise AgentError(f"download failed for {redact_url(url)}: HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise AgentError(f"download failed for {redact_url(url)}: {exc.reason}") from exc

    def _json_request(
        self,
        method: str,
        url: str,
        payload: dict[str, Any] | None,
    ) -> dict[str, Any]:
        body = None
        headers = {"Authorization": f"Key {self.api_key}"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                data = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise AgentError(f"fal request failed: {method} {url} HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AgentError(f"fal request failed: {method} {url}: {exc.reason}") from exc

        if not data:
            return {}
        try:
            return json.loads(data)
        except json.JSONDecodeError as exc:
            raise AgentError(f"fal returned non-JSON response from {url}") from exc


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        run_agent(args)
    except AgentError as exc:
        print(f"fal-media-agent: {exc}", file=sys.stderr)
        return 1
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--script",
        required=True,
        type=Path,
        help="Canonical lesson-script.json or supported Markdown full-script input.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Run root. The agent writes lesson-script.json and asset-manifest.json here.",
    )
    parser.add_argument("--run-id", help="Stable run id. Defaults to output directory name.")
    parser.add_argument(
        "--mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    parser.add_argument("--voice", default=os.environ.get("FAL_TTS_VOICE", "Friendly_Person"))
    parser.add_argument("--emotion", default=os.environ.get("FAL_TTS_EMOTION", "happy"))
    parser.add_argument("--language", default=os.environ.get("FAL_TTS_LANGUAGE", "en"))
    parser.add_argument("--image-size", default=os.environ.get("FAL_IMAGE_SIZE", "landscape_16_9"))
    parser.add_argument(
        "--image-steps",
        default=int(os.environ.get("FAL_IMAGE_STEPS", "8")),
        type=int,
    )
    parser.add_argument(
        "--max-workers",
        default=int(os.environ.get("FAL_MAX_WORKERS", "7")),
        type=int,
    )
    parser.add_argument(
        "--poll-interval-seconds",
        default=float(os.environ.get("FAL_POLL_INTERVAL_SECONDS", "2")),
        type=float,
    )
    parser.add_argument(
        "--timeout-seconds",
        default=int(os.environ.get("FAL_TIMEOUT_SECONDS", "600")),
        type=int,
    )
    parser.add_argument(
        "--intro-seconds",
        default=int(os.environ.get("FAL_INTRO_SECONDS", "5")),
        type=int,
        help=(
            "Target duration for the talking-head intro audio clip. Advisory "
            "only, like the per-slide target_duration_seconds hints below — "
            "the TTS model does not enforce a duration."
        ),
    )
    return parser.parse_args(argv)


def run_agent(
    args: argparse.Namespace,
    *,
    client: FalQueueClient | None = None,
    preflight: bool = True,
) -> dict[str, Any]:
    run_id = args.run_id or args.output_dir.name
    paths = build_paths(args.output_dir)
    ensure_dirs(paths)

    lesson = load_lesson_script(args.script)
    normalize_lesson_script(lesson, run_id)
    write_json(paths.lesson_script_path, lesson)

    slide_payloads = build_slide_payloads(
        lesson,
        run_id=run_id,
        image_size=args.image_size,
        image_steps=args.image_steps,
    )
    voice_payload = build_voice_payload(
        lesson,
        run_id=run_id,
        voice=args.voice,
        emotion=args.emotion,
        language=args.language,
    )
    intro_payload = (
        build_intro_audio_payload(
            lesson,
            run_id=run_id,
            voice=args.voice,
            emotion=args.emotion,
            language=args.language,
            target_seconds=args.intro_seconds,
        )
        if lesson.get("intro")
        else None
    )
    write_json(paths.content_dir / "slide-image-prompts.json", slide_payloads)
    write_json(paths.content_dir / "voiceover-payload.json", voice_payload)
    if intro_payload is not None:
        write_json(paths.content_dir / "talking-head-intro-audio-payload.json", intro_payload)

    if args.mode != "dry-run":
        if preflight:
            run_fal_preflight()
        if client is None:
            fal_key = os.environ.get("FAL_KEY")
            if not fal_key:
                raise AgentError("FAL_KEY is required outside dry-run mode")
            client = FalQueueClient(
                fal_key,
                base_url=os.environ.get("FAL_BASE_URL", "https://queue.fal.run"),
            )

    image_workers = min(max(1, args.max_workers), max(1, len(slide_payloads)))
    if args.mode == "dry-run":
        slide_assets = [
            dry_run_image_asset(item, paths)
            for item in slide_payloads
        ]
        voice_asset = dry_run_voice_asset(paths)
        intro_audio_asset = dry_run_intro_audio_asset(paths) if intro_payload is not None else None
    else:
        assert client is not None
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as executor:
            image_futures = [
                executor.submit(
                    generate_slide_image,
                    client,
                    item,
                    paths,
                    args.poll_interval_seconds,
                    args.timeout_seconds,
                )
                for item in slide_payloads[:image_workers]
            ]
            remaining_payloads = slide_payloads[image_workers:]
            active = set(image_futures)
            slide_assets = []
            voice_future = executor.submit(
                generate_voiceover,
                client,
                voice_payload,
                paths,
                args.poll_interval_seconds,
                args.timeout_seconds,
            )
            intro_future = (
                executor.submit(
                    generate_intro_audio,
                    client,
                    intro_payload,
                    paths,
                    args.poll_interval_seconds,
                    args.timeout_seconds,
                )
                if intro_payload is not None
                else None
            )
            for payload in remaining_payloads:
                done, active = concurrent.futures.wait(
                    active,
                    return_when=concurrent.futures.FIRST_COMPLETED,
                )
                for future in done:
                    slide_assets.append(future.result())
                active.add(
                    executor.submit(
                        generate_slide_image,
                        client,
                        payload,
                        paths,
                        args.poll_interval_seconds,
                        args.timeout_seconds,
                    )
                )
            for future in concurrent.futures.as_completed(active):
                slide_assets.append(future.result())
            voice_asset = voice_future.result()
            intro_audio_asset = intro_future.result() if intro_future is not None else None

        slide_assets.sort(key=lambda item: item["slide_id"])

    timings = estimate_timings(lesson)
    timings_path = paths.content_dir / "narration-timings.json"
    write_json(timings_path, {"estimated": True, "segments": timings})

    manifest = build_asset_manifest(
        run_id=run_id,
        lesson_script_path=paths.lesson_script_path,
        slide_assets=slide_assets,
        voice_asset=voice_asset,
        intro_audio_asset=intro_audio_asset,
        timings=timings,
    )
    write_json(paths.manifest_path, manifest)
    return manifest


def build_paths(output_dir: Path) -> Paths:
    run_root = output_dir
    content_dir = run_root / "02-content-generation"
    return Paths(
        run_root=run_root,
        content_dir=content_dir,
        provider_dir=content_dir / "provider",
        slide_image_dir=content_dir / "slide-images",
        manifest_path=run_root / "asset-manifest.json",
        lesson_script_path=run_root / "lesson-script.json",
    )


def ensure_dirs(paths: Paths) -> None:
    paths.run_root.mkdir(parents=True, exist_ok=True)
    paths.content_dir.mkdir(parents=True, exist_ok=True)
    paths.provider_dir.mkdir(parents=True, exist_ok=True)
    paths.slide_image_dir.mkdir(parents=True, exist_ok=True)


def load_lesson_script(script_path: Path) -> dict[str, Any]:
    text = script_path.read_text(encoding="utf-8")
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            lesson = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AgentError(f"invalid JSON script: {script_path}: {exc}") from exc
        if not isinstance(lesson, dict):
            raise AgentError("lesson script JSON must be an object")
        return lesson
    return parse_markdown_script(text)


def parse_markdown_script(text: str) -> dict[str, Any]:
    matches = list(SLIDE_HEADING_RE.finditer(text))
    if not matches:
        raise AgentError(
            "Markdown script must contain headings like 'Slide 1: Title' for each slide"
        )

    topic = first_topic_line(text[: matches[0].start()]) or "Untitled lesson"
    slides = []
    for index, match in enumerate(matches):
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        title = match.group(2).strip()
        body = text[body_start:body_end].strip()
        fields = parse_slide_fields(body)
        narration = fields.get("narration") or fields.get("script") or fields.get("voiceover")
        visual = fields.get("visual") or fields.get("visual brief") or fields.get("image")
        if not narration:
            raise AgentError(f"slide {index + 1} is missing a Narration field")
        if not visual:
            visual = f"Concrete visual explanation for {title}."
        duration = parse_duration(fields.get("duration")) or estimate_duration_seconds(narration)
        slides.append(
            {
                "id": f"slide-{index + 1:02d}",
                "title": title,
                "key_points": parse_key_points(fields.get("key points") or fields.get("key point")),
                "narration": narration,
                "visual_brief": visual,
                "duration_seconds": duration,
            }
        )

    return {
        "topic": topic,
        "learning_objective": f"Understand {topic}.",
        "audience": "general learners",
        "duration_seconds": sum(slide["duration_seconds"] for slide in slides),
        "style_notes": ["Parsed from Markdown full-script input."],
        "intro": {
            "hook": topic,
            "talking_head_script": f"Let's walk through {topic}.",
            "duration_seconds": 10,
        },
        "slides": slides,
        "sources": [],
    }


def first_topic_line(prefix: str) -> str | None:
    for line in prefix.splitlines():
        cleaned = line.strip().lstrip("#").strip()
        if cleaned:
            return cleaned
    return None


def parse_slide_fields(body: str) -> dict[str, str]:
    fields: dict[str, list[str]] = {}
    current: str | None = None
    for line in body.splitlines():
        match = FIELD_RE.match(line)
        if match:
            current = normalized_field_name(match.group(1))
            fields.setdefault(current, [])
            if match.group(2).strip():
                fields[current].append(match.group(2).strip())
            continue
        if current:
            fields[current].append(line.rstrip())
    return {key: "\n".join(value).strip() for key, value in fields.items()}


def normalized_field_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def parse_key_points(raw: str | None) -> list[str]:
    if not raw:
        return []
    points = []
    for line in raw.splitlines():
        cleaned = re.sub(r"^\s*[-*]\s*", "", line).strip()
        if cleaned:
            points.append(cleaned)
    return points


def parse_duration(raw: str | None) -> int | None:
    if not raw:
        return None
    match = re.search(r"(\d+)", raw)
    if not match:
        return None
    return max(5, int(match.group(1)))


def estimate_duration_seconds(narration: str) -> int:
    words = re.findall(r"\b\w+\b", narration)
    return max(5, round(len(words) / 2.5))


def normalize_lesson_script(lesson: dict[str, Any], run_id: str) -> None:
    slides = lesson.get("slides")
    if not isinstance(slides, list) or not slides:
        raise AgentError("lesson script must contain a non-empty slides array")
    for index, slide in enumerate(slides, start=1):
        if not isinstance(slide, dict):
            raise AgentError(f"slide {index} must be an object")
        slide.setdefault("id", f"slide-{index:02d}")
        slide.setdefault("key_points", [])
        for field in ("title", "narration", "visual_brief"):
            if not slide.get(field):
                raise AgentError(f"{slide['id']} is missing required field '{field}'")
        slide.setdefault("duration_seconds", estimate_duration_seconds(slide["narration"]))

    lesson.setdefault("topic", run_id)
    lesson.setdefault("learning_objective", f"Understand {lesson['topic']}.")
    lesson.setdefault("audience", "general learners")
    lesson.setdefault(
        "duration_seconds",
        sum(int(slide.get("duration_seconds", 0)) for slide in slides),
    )
    lesson.setdefault(
        "intro",
        {
            "hook": str(lesson["topic"]),
            "talking_head_script": f"Let's walk through {lesson['topic']}.",
            "duration_seconds": 10,
        },
    )
    lesson.setdefault("sources", [])


def build_slide_payloads(
    lesson: dict[str, Any],
    *,
    run_id: str,
    image_size: str,
    image_steps: int,
) -> list[dict[str, Any]]:
    payloads = []
    style_block = build_style_block(lesson)
    for slide in lesson["slides"]:
        prompt = "\n".join(
            [
                f"Slide id: {slide['id']}",
                f"Slide title: {slide['title']}",
                f"Visual brief: {slide['visual_brief']}",
                f"Key points: {', '.join(slide.get('key_points') or [])}",
                f"Shared style: {style_block}",
                f"Negative guidance: {NEGATIVE_IMAGE_GUIDANCE}",
            ]
        )
        provider_payload = {
            "prompt": prompt,
            "image_size": image_size,
            "num_inference_steps": image_steps,
            "sync_mode": False,
            "num_images": 1,
            "enable_safety_checker": True,
            "output_format": "png",
            "acceleration": "regular",
            "enable_prompt_expansion": False,
            "seed": stable_seed(run_id, slide["id"]),
        }
        payloads.append(
            {
                "slide_id": slide["id"],
                "title": slide["title"],
                "prompt": prompt,
                "endpoint": IMAGE_ENDPOINT,
                "payload": provider_payload,
            }
        )
    return payloads


def build_style_block(lesson: dict[str, Any]) -> str:
    style_notes = lesson.get("style_notes") or []
    if not isinstance(style_notes, list):
        style_notes = [str(style_notes)]
    notes = "; ".join(str(note) for note in style_notes if str(note).strip())
    if notes:
        return f"{DEFAULT_ART_DIRECTION} Lesson style notes: {notes}"
    return DEFAULT_ART_DIRECTION


def build_voice_payload(
    lesson: dict[str, Any],
    *,
    run_id: str,
    voice: str,
    emotion: str,
    language: str,
) -> dict[str, Any]:
    segments = [
        {
            "slide_id": slide["id"],
            "text": slide["narration"],
            "target_duration_seconds": slide.get("duration_seconds"),
        }
        for slide in lesson["slides"]
    ]
    text = "\n[pause]\n".join(segment["text"].strip() for segment in segments)
    if len(text) > VOICE_TEXT_LIMIT:
        raise AgentError(
            f"combined narration exceeds {VOICE_ENDPOINT} {VOICE_TEXT_LIMIT:,} character limit; "
            "split generation is needed"
        )
    return {
        "run_id": run_id,
        "endpoint": VOICE_ENDPOINT,
        "voice": voice,
        "emotion": emotion,
        "language": language,
        "segments": segments,
        "target_duration_seconds": sum(
            int(segment["target_duration_seconds"] or estimate_duration_seconds(segment["text"]))
            for segment in segments
        ),
        "payload": {
            "prompt": text,
            "voice_setting": {
                "voice_id": voice,
                "emotion": emotion,
            },
            "language_boost": language_boost(language),
            "output_format": "url",
        },
    }


def build_intro_audio_payload(
    lesson: dict[str, Any],
    *,
    run_id: str,
    voice: str,
    emotion: str,
    language: str,
    target_seconds: int,
) -> dict[str, Any]:
    """Payload for the short talking-head intro clip, kept separate from the
    combined slide narration so it can be generated and swapped independently.
    """
    text = lesson["intro"]["talking_head_script"].strip()
    return {
        "run_id": run_id,
        "endpoint": VOICE_ENDPOINT,
        "voice": voice,
        "emotion": emotion,
        "language": language,
        "target_duration_seconds": target_seconds,
        "payload": {
            "prompt": text,
            "voice_setting": {
                "voice_id": voice,
                "emotion": emotion,
            },
            "language_boost": language_boost(language),
            "output_format": "url",
        },
    }


def language_boost(language: str) -> str:
    """Map an ISO language code to a MiniMax `language_boost` value."""
    return LANGUAGE_BOOSTS.get(language.strip().lower(), "auto")


def stable_seed(run_id: str, slide_id: str) -> int:
    digest = hashlib.sha256(f"{run_id}:{slide_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def dry_run_image_asset(item: dict[str, Any], paths: Paths) -> dict[str, Any]:
    metadata_path = paths.provider_dir / f"{item['slide_id']}-dry-run.json"
    write_json(metadata_path, {"mode": "dry-run", "request": item})
    return {
        "slide_id": item["slide_id"],
        "path": relative_path(paths.run_root, paths.slide_image_dir / f"{item['slide_id']}.png"),
        "media_type": "image/png",
        "provider": "fal.ai",
        "provider_job_id": f"dry-run-{item['slide_id']}",
        "prompt": item["prompt"],
        "metadata_path": relative_path(paths.run_root, metadata_path),
    }


def dry_run_voice_asset(paths: Paths) -> dict[str, Any]:
    metadata_path = paths.provider_dir / "voiceover-dry-run.json"
    write_json(metadata_path, {"mode": "dry-run", "provider": "fal.ai", "endpoint": VOICE_ENDPOINT})
    return {
        "path": relative_path(paths.run_root, paths.content_dir / "voiceover.mp3"),
        "media_type": "audio/mpeg",
        "provider": "fal.ai",
        "provider_job_id": "dry-run-voiceover",
        "metadata_path": relative_path(paths.run_root, metadata_path),
    }


def dry_run_intro_audio_asset(paths: Paths) -> dict[str, Any]:
    metadata_path = paths.provider_dir / "talking-head-intro-audio-dry-run.json"
    write_json(metadata_path, {"mode": "dry-run", "provider": "fal.ai", "endpoint": VOICE_ENDPOINT})
    return {
        "path": relative_path(paths.run_root, paths.content_dir / "talking-head-intro-audio.mp3"),
        "media_type": "audio/mpeg",
        "provider": "fal.ai",
        "provider_job_id": "dry-run-intro-audio",
        "metadata_path": relative_path(paths.run_root, metadata_path),
    }


def generate_slide_image(
    client: FalQueueClient,
    item: dict[str, Any],
    paths: Paths,
    poll_interval_seconds: float,
    timeout_seconds: int,
) -> dict[str, Any]:
    request = client.submit(item["endpoint"], item["payload"])
    request_id = require_request_id(request, item["slide_id"])
    write_json(paths.provider_dir / f"{item['slide_id']}-submit.json", sanitize_provider_json(request))
    result = wait_for_result(client, request, poll_interval_seconds, timeout_seconds)
    write_json(paths.provider_dir / f"{item['slide_id']}-response.json", sanitize_provider_json(result))
    data = unwrap_result_data(result)
    image_url = data.get("images", [{}])[0].get("url")
    if not image_url:
        raise AgentError(f"{item['slide_id']} response did not include images[0].url")
    output_path = paths.slide_image_dir / f"{item['slide_id']}.png"
    client.download(image_url, output_path)
    return {
        "slide_id": item["slide_id"],
        "path": relative_path(paths.run_root, output_path),
        "media_type": "image/png",
        "provider": "fal.ai",
        "provider_job_id": request_id,
        "prompt": item["prompt"],
        "metadata_path": relative_path(paths.run_root, paths.provider_dir / f"{item['slide_id']}-response.json"),
    }


def generate_voiceover(
    client: FalQueueClient,
    item: dict[str, Any],
    paths: Paths,
    poll_interval_seconds: float,
    timeout_seconds: int,
) -> dict[str, Any]:
    request = client.submit(item["endpoint"], item["payload"])
    request_id = require_request_id(request, "voiceover")
    write_json(paths.provider_dir / "voiceover-submit.json", sanitize_provider_json(request))
    result = wait_for_result(client, request, poll_interval_seconds, timeout_seconds)
    write_json(paths.provider_dir / "voiceover-response.json", sanitize_provider_json(result))
    data = unwrap_result_data(result)
    audio_url = data.get("audio", {}).get("url")
    if not audio_url:
        raise AgentError("voiceover response did not include audio.url")
    output_path = paths.content_dir / "voiceover.mp3"
    client.download(audio_url, output_path)
    return {
        "path": relative_path(paths.run_root, output_path),
        "media_type": "audio/mpeg",
        "provider": "fal.ai",
        "provider_job_id": request_id,
        "metadata_path": relative_path(paths.run_root, paths.provider_dir / "voiceover-response.json"),
    }


def generate_intro_audio(
    client: FalQueueClient,
    item: dict[str, Any],
    paths: Paths,
    poll_interval_seconds: float,
    timeout_seconds: int,
) -> dict[str, Any]:
    request = client.submit(item["endpoint"], item["payload"])
    request_id = require_request_id(request, "talking-head-intro-audio")
    write_json(paths.provider_dir / "talking-head-intro-audio-submit.json", sanitize_provider_json(request))
    result = wait_for_result(client, request, poll_interval_seconds, timeout_seconds)
    write_json(paths.provider_dir / "talking-head-intro-audio-response.json", sanitize_provider_json(result))
    data = unwrap_result_data(result)
    audio_url = data.get("audio", {}).get("url")
    if not audio_url:
        raise AgentError("intro audio response did not include audio.url")
    output_path = paths.content_dir / "talking-head-intro-audio.mp3"
    client.download(audio_url, output_path)
    return {
        "path": relative_path(paths.run_root, output_path),
        "media_type": "audio/mpeg",
        "provider": "fal.ai",
        "provider_job_id": request_id,
        "metadata_path": relative_path(
            paths.run_root, paths.provider_dir / "talking-head-intro-audio-response.json"
        ),
    }


def require_request_id(response: dict[str, Any], label: str) -> str:
    request_id = response.get("request_id") or response.get("requestId")
    if not request_id:
        raise AgentError(f"{label} submit response did not include request_id")
    return str(request_id)


def wait_for_result(
    client: FalQueueClient,
    submit_response: dict[str, Any],
    poll_interval_seconds: float,
    timeout_seconds: int,
) -> dict[str, Any]:
    status_url = submit_response.get("status_url") or submit_response.get("statusUrl")
    response_url = submit_response.get("response_url") or submit_response.get("responseUrl")
    if not status_url or not response_url:
        raise AgentError("fal submit response must include status_url and response_url")

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        status = client.status(str(status_url))
        state = str(status.get("status", "")).upper()
        if state in {"COMPLETED", "SUCCESS", "SUCCEEDED"}:
            return client.result(str(response_url))
        if state in {"FAILED", "ERROR", "CANCELLED"}:
            raise AgentError(f"fal request failed with status {state}: {json.dumps(status)[:500]}")
        time.sleep(poll_interval_seconds)
    raise AgentError("timed out waiting for fal request to complete")


def unwrap_result_data(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    if isinstance(data, dict):
        return data
    return result


def estimate_timings(lesson: dict[str, Any]) -> list[dict[str, float | str]]:
    cursor = 0.0
    timings = []
    for slide in lesson["slides"]:
        duration = float(slide.get("duration_seconds") or estimate_duration_seconds(slide["narration"]))
        timings.append(
            {
                "slide_id": slide["id"],
                "start_seconds": round(cursor, 3),
                "end_seconds": round(cursor + duration, 3),
            }
        )
        cursor += duration
    return timings


def build_asset_manifest(
    *,
    run_id: str,
    lesson_script_path: Path,
    slide_assets: list[dict[str, Any]],
    voice_asset: dict[str, Any],
    intro_audio_asset: dict[str, Any] | None,
    timings: list[dict[str, float | str]],
) -> dict[str, Any]:
    assets: dict[str, Any] = {
        # Filled in by the veed-talking-head skill once the VEED Fabric MCP
        # video call completes; see codex/skills/veed-talking-head.
        "talking_head_intro": {
            "path": "02-content-generation/talking-head-intro.mp4",
            "media_type": "video/mp4",
            "provider": "pending",
        },
        "slide_images": slide_assets,
        "voiceover": voice_asset,
    }
    if intro_audio_asset is not None:
        assets["talking_head_intro_audio"] = intro_audio_asset
    return {
        "run_id": run_id,
        "lesson_script": lesson_script_path.name,
        "assets": assets,
        "timings": timings,
    }


def run_fal_preflight() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    check_env = repo_root / "scripts" / "check-env.sh"
    if not check_env.exists():
        raise AgentError("scripts/check-env.sh is required for fal credential preflight")
    result = subprocess.run(
        [str(check_env), "fal"],
        cwd=repo_root,
        check=False,
    )
    if result.returncode != 0:
        raise AgentError("fal credential preflight failed; run through scripts/with-env.sh")


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


def relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
