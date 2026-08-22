#!/usr/bin/env python3
"""Generate slide images and lesson voiceover entirely offline.

This is the no-credential counterpart to fal_media_agent.py: it emits the same
`02-content-generation/` layout (slide-images/, voiceover, narration-timings)
from a lesson script, using PIL for the slides and espeak-ng for the narration.
Nothing here touches the network, so it works in sandboxes with no FAL_KEY.

Timings are measured from the rendered audio rather than estimated from word
counts, which is why the emitted narration-timings.json sets "estimated": false
and assemble_slideshow_video.py can trust the timeline as-is.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from PIL import Image, ImageDraw, ImageFont


FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONT_REGULAR = FONT_DIR / "DejaVuSans.ttf"
FONT_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"

BACKGROUND = (14, 20, 28)
PANEL = (21, 29, 40)
TITLE_COLOR = (244, 248, 252)
BODY_COLOR = (203, 216, 229)
ACCENT = (77, 194, 255)
MUTED = (117, 133, 150)

# espeak-ng emits 22.05 kHz 16-bit mono; the concatenator verifies rather than
# assumes, but the silence generator needs a default when there is no speech.
DEFAULT_SAMPLE_PARAMS = (1, 2, 22050)


class AgentError(RuntimeError):
    """Raised for expected workflow failures."""


@dataclass(frozen=True)
class Paths:
    run_root: Path
    content_dir: Path
    slide_image_dir: Path
    voiceover_path: Path
    timings_path: Path
    manifest_path: Path
    lesson_script_path: Path


@dataclass(frozen=True)
class Segment:
    slide_id: str
    start_seconds: float
    end_seconds: float


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.self_test:
            run_self_test(args)
            return 0
        if args.script is None or args.output_dir is None:
            raise AgentError("--script and --output-dir are required unless --self-test is used")
        manifest = run_agent(args)
        print(f"wrote {manifest['assets']['voiceover']['path']} and "
              f"{len(manifest['assets']['slide_images'])} slides under {args.output_dir}",
              file=sys.stderr)
    except AgentError as exc:
        print(f"local-media-agent: {exc}", file=sys.stderr)
        return 1
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", type=Path, help="Canonical lesson-script.json input.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Run root. Assets land in <output-dir>/02-content-generation/.",
    )
    parser.add_argument("--run-id", help="Stable run id. Defaults to output directory name.")
    parser.add_argument("--voice", default="en-us", help="espeak-ng voice (default: en-us).")
    parser.add_argument("--wpm", type=int, default=150, help="Narration speed in words per minute.")
    parser.add_argument(
        "--resolution",
        default="1920x1080",
        help="Slide resolution as WIDTHxHEIGHT (default: 1920x1080).",
    )
    parser.add_argument(
        "--gap-seconds",
        type=float,
        default=0.3,
        help="Silence appended to each slide's narration so slides do not run together.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Render a synthetic two-slide lesson into a temp dir and verify the outputs.",
    )
    return parser.parse_args(argv)


def run_agent(args: argparse.Namespace) -> dict[str, Any]:
    require_binary("espeak-ng")
    width, height = parse_resolution(args.resolution)
    run_id = args.run_id or args.output_dir.name
    paths = build_paths(args.output_dir)
    ensure_dirs(paths)

    lesson = load_lesson_script(args.script)
    normalize_lesson_script(lesson, run_id)
    write_json(paths.lesson_script_path, lesson)

    slides = lesson["slides"]
    # assemble_slideshow_video.py resolves audio as (mp3, wav, m4a) and takes the
    # first hit, so a voiceover.mp3 left behind by an earlier fal run silently
    # wins over the wav we are about to write - yielding a video built on the
    # wrong audio, with exit 0 and no warning. Same hazard the orphaned-PNG
    # prune already handles.
    for stale_name in ("voiceover.mp3", "voiceover.m4a"):
        (paths.content_dir / stale_name).unlink(missing_ok=True)

    slide_assets = render_slide_images(lesson, paths.slide_image_dir, width, height)
    segments = synthesize_voiceover(
        slides,
        paths.voiceover_path,
        voice=args.voice,
        wpm=args.wpm,
        gap_seconds=max(0.0, args.gap_seconds),
    )

    write_json(
        paths.timings_path,
        {
            "estimated": False,
            "segments": [
                {
                    "slide_id": segment.slide_id,
                    "start_seconds": segment.start_seconds,
                    "end_seconds": segment.end_seconds,
                }
                for segment in segments
            ],
        },
    )

    manifest = build_asset_manifest(
        run_id=run_id,
        paths=paths,
        lesson=lesson,
        slide_assets=slide_assets,
        segments=segments,
        voice=args.voice,
        wpm=args.wpm,
        resolution=f"{width}x{height}",
    )
    write_json(paths.manifest_path, manifest)
    return manifest


def build_paths(output_dir: Path) -> Paths:
    content_dir = output_dir / "02-content-generation"
    return Paths(
        run_root=output_dir,
        content_dir=content_dir,
        slide_image_dir=content_dir / "slide-images",
        voiceover_path=content_dir / "voiceover.wav",
        timings_path=content_dir / "narration-timings.json",
        manifest_path=output_dir / "asset-manifest.json",
        lesson_script_path=output_dir / "lesson-script.json",
    )


def ensure_dirs(paths: Paths) -> None:
    paths.slide_image_dir.mkdir(parents=True, exist_ok=True)


def parse_resolution(value: str) -> tuple[int, int]:
    try:
        width, height = (int(part) for part in value.lower().split("x", 1))
    except ValueError as exc:
        raise AgentError(f"invalid --resolution {value!r}; expected WIDTHxHEIGHT") from exc
    if width < 320 or height < 180:
        raise AgentError(f"invalid --resolution {value!r}; minimum is 320x180")
    return width, height


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise AgentError(f"{name} not found on PATH")
    return path


def load_lesson_script(script_path: Path) -> dict[str, Any]:
    try:
        text = script_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise AgentError(f"cannot read lesson script {script_path}: {exc}") from exc
    try:
        lesson = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentError(f"invalid JSON script: {script_path}: {exc}") from exc
    if not isinstance(lesson, dict):
        raise AgentError("lesson script JSON must be an object")
    return lesson


def normalize_lesson_script(lesson: dict[str, Any], run_id: str) -> None:
    slides = lesson.get("slides")
    if not isinstance(slides, list) or not slides:
        raise AgentError("lesson script must contain a non-empty slides array")
    for index, slide in enumerate(slides, start=1):
        if not isinstance(slide, dict):
            raise AgentError(f"slide {index} must be an object")
        slide.setdefault("id", f"slide-{index:02d}")
        # The id becomes a path component for the slide PNG and the espeak clip.
        # A model-authored script can carry anything here - the contract's
        # ^slide-[0-9]{2}$ pattern is not enforced by structured-output providers
        # and the bridge does not re-validate - so an id like "../../escaped"
        # would write outside the run directory while the run reported success.
        slide_id = str(slide["id"])
        if slide_id in {"", ".", ".."} or slide_id != Path(slide_id).name:
            raise AgentError(f"slide id {slide_id!r} is not a usable filename")
        slide["id"] = slide_id
        for field in ("title", "narration"):
            if not str(slide.get(field) or "").strip():
                raise AgentError(f"{slide['id']} is missing required field '{field}'")
        key_points = slide.get("key_points")
        if not isinstance(key_points, list):
            slide["key_points"] = []

    ids = [str(slide["id"]) for slide in slides]
    if len(set(ids)) != len(ids):
        raise AgentError("slide ids must be unique")

    lesson.setdefault("topic", run_id)
    lesson.setdefault("title", str(lesson["topic"]))


def render_slide_images(
    lesson: dict[str, Any],
    slide_dir: Path,
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    slides = lesson["slides"]
    expected = {f"{slide['id']}.png" for slide in slides}
    # Re-runs of a shorter script must not leave orphaned slides behind for
    # assemble_slideshow_video.py to pick up.
    for stale in slide_dir.glob("slide-*.png"):
        if stale.name not in expected:
            stale.unlink()

    lesson_title = str(lesson.get("title") or lesson.get("topic") or "")
    assets = []
    for index, slide in enumerate(slides, start=1):
        path = slide_dir / f"{slide['id']}.png"
        render_slide(
            path,
            width=width,
            height=height,
            title=str(slide["title"]),
            body_lines=slide_body_lines(slide),
            footer_left=lesson_title,
            footer_right=f"{index} / {len(slides)}",
        )
        assets.append(
            {
                "slide_id": str(slide["id"]),
                "path": relative_path(slide_dir.parents[1], path),
                "media_type": "image/png",
                "provider": "local-pil",
                "width": width,
                "height": height,
            }
        )
    return assets


def slide_body_lines(slide: dict[str, Any]) -> list[str]:
    points = [str(point).strip() for point in slide.get("key_points") or []]
    points = [point for point in points if point]
    if points:
        return points
    return [str(slide.get("narration") or "").strip()]


def render_slide(
    path: Path,
    *,
    width: int,
    height: int,
    title: str,
    body_lines: Sequence[str],
    footer_left: str,
    footer_right: str,
) -> None:
    scale = height / 1080
    margin = round(110 * scale)
    image = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(image)

    # A slightly lighter inset panel keeps the text away from the frame edge and
    # gives every slide the same visual footprint regardless of body length.
    inset = round(44 * scale)
    draw.rectangle((inset, inset, width - inset, height - inset), fill=PANEL)

    footer_font = load_font(FONT_REGULAR, max(12, round(26 * scale)))
    footer_height = round(footer_font.size * 1.6)
    footer_top = height - margin - footer_height

    title_box = (width - 2 * margin, round(height * 0.30))
    title_font, title_lines = fit_text_block(
        [title],
        FONT_BOLD,
        max_width=title_box[0],
        max_height=title_box[1],
        max_size=round(84 * scale),
        min_size=round(36 * scale),
        line_spacing=1.18,
        bullet=False,
    )
    line_height = round(title_font.size * 1.18)
    cursor = margin
    for line in title_lines:
        draw.text((margin, cursor), line, font=title_font, fill=TITLE_COLOR)
        cursor += line_height

    rule_y = cursor + round(26 * scale)
    draw.rectangle(
        (margin, rule_y, margin + round(180 * scale), rule_y + max(3, round(6 * scale))),
        fill=ACCENT,
    )

    # Anchor the body below the tallest possible title so every slide in a deck
    # starts its bullets on the same line.
    body_top = margin + title_box[1] + round(84 * scale)
    body_font, body_lines_wrapped = fit_text_block(
        body_lines,
        FONT_REGULAR,
        max_width=width - 2 * margin - round(46 * scale),
        max_height=max(round(60 * scale), footer_top - body_top - round(30 * scale)),
        max_size=round(52 * scale),
        min_size=round(24 * scale),
        line_spacing=1.45,
        bullet=True,
    )
    body_line_height = round(body_font.size * 1.45)
    cursor = body_top
    for line, is_first in body_lines_wrapped:
        if is_first:
            dot_radius = max(3, round(body_font.size * 0.13))
            dot_y = cursor + round(body_font.size * 0.55)
            draw.ellipse(
                (margin, dot_y - dot_radius, margin + 2 * dot_radius, dot_y + dot_radius),
                fill=ACCENT,
            )
        draw.text((margin + round(46 * scale), cursor), line, font=body_font, fill=BODY_COLOR)
        cursor += body_line_height

    draw.text((margin, footer_top), truncate_to_width(footer_left, footer_font, width // 2),
              font=footer_font, fill=MUTED)
    right_width = footer_font.getlength(footer_right)
    draw.text((width - margin - right_width, footer_top), footer_right, font=footer_font, fill=MUTED)

    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")


def load_font(font_path: Path, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(font_path), max(8, size))
    except OSError as exc:
        raise AgentError(f"cannot load font {font_path}: {exc}") from exc


def fit_text_block(
    paragraphs: Sequence[str],
    font_path: Path,
    *,
    max_width: int,
    max_height: int,
    max_size: int,
    min_size: int,
    line_spacing: float,
    bullet: bool,
) -> tuple[ImageFont.FreeTypeFont, list[Any]]:
    """Shrink until the wrapped paragraphs fit the box, then hard-clip."""
    texts = [text for text in (paragraph.strip() for paragraph in paragraphs) if text]
    if not texts:
        return load_font(font_path, min_size), []

    font = load_font(font_path, min_size)
    lines: list[Any] = []
    for size in range(max(max_size, min_size), min_size - 1, -2):
        font = load_font(font_path, size)
        lines = []
        for text in texts:
            wrapped = wrap_text(text, font, max_width)
            lines.extend((line, index == 0) for index, line in enumerate(wrapped))
        if len(lines) * round(size * line_spacing) <= max_height:
            break

    max_lines = max(1, max_height // max(1, round(font.size * line_spacing)))
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        text, is_first = lines[-1]
        lines[-1] = (truncate_to_width(text + "…", font, max_width), is_first)

    if bullet:
        return font, lines
    return font, [line for line, _ in lines]


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
        # A single word wider than the box still has to be broken somewhere.
        while font.getlength(current) > max_width and len(current) > 1:
            cut = len(current) - 1
            while cut > 1 and font.getlength(current[:cut]) > max_width:
                cut -= 1
            lines.append(current[:cut])
            current = current[cut:]
    if current:
        lines.append(current)
    return lines or [""]


def truncate_to_width(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    if font.getlength(text) <= max_width:
        return text
    truncated = text
    while truncated and font.getlength(truncated + "…") > max_width:
        truncated = truncated[:-1]
    return truncated + "…"


def synthesize_voiceover(
    slides: Sequence[dict[str, Any]],
    output_path: Path,
    *,
    voice: str,
    wpm: int,
    gap_seconds: float,
) -> list[Segment]:
    espeak = require_binary("espeak-ng")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="local-media-agent-") as tmp:
        tmp_dir = Path(tmp)
        clips: list[tuple[str, Path]] = []
        for slide in slides:
            clip_path = tmp_dir / f"{slide['id']}.wav"
            speak(espeak, str(slide["narration"]), clip_path, voice=voice, wpm=wpm)
            clips.append((str(slide["id"]), clip_path))
        return concatenate_wavs(clips, output_path, gap_seconds=gap_seconds)


def speak(espeak: str, text: str, output_path: Path, *, voice: str, wpm: int) -> None:
    result = subprocess.run(
        [espeak, "-v", voice, "-s", str(max(80, min(450, wpm))), "-w", str(output_path), "--stdin"],
        input=text,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AgentError(f"espeak-ng failed: {result.stderr.strip() or result.returncode}")
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise AgentError(f"espeak-ng produced no audio for {output_path.name}")


def concatenate_wavs(
    clips: Sequence[tuple[str, Path]],
    output_path: Path,
    *,
    gap_seconds: float,
) -> list[Segment]:
    """Join the per-slide clips and derive timings from real frame counts."""
    params: Any = None
    frame_counts: list[int] = []
    payloads: list[bytes] = []
    for _, clip_path in clips:
        with contextlib.closing(wave.open(str(clip_path), "rb")) as clip:
            clip_params = (clip.getnchannels(), clip.getsampwidth(), clip.getframerate())
            if params is None:
                params = clip_params
            elif clip_params != params:
                raise AgentError(
                    f"espeak-ng emitted mismatched audio formats: {params} vs {clip_params}"
                )
            payloads.append(clip.readframes(clip.getnframes()))
            frame_counts.append(clip.getnframes())

    channels, sample_width, frame_rate = params or DEFAULT_SAMPLE_PARAMS
    gap_frames = int(round(gap_seconds * frame_rate))
    silence = b"\x00" * (gap_frames * channels * sample_width)

    with contextlib.closing(wave.open(str(output_path), "wb")) as out:
        out.setnchannels(channels)
        out.setsampwidth(sample_width)
        out.setframerate(frame_rate)
        for payload in payloads:
            out.writeframes(payload)
            if gap_frames:
                out.writeframes(silence)

    boundaries = [0.0]
    cursor = 0
    for count in frame_counts:
        cursor += count + gap_frames
        boundaries.append(round(cursor / frame_rate, 3))
    return [
        Segment(slide_id, boundaries[index], boundaries[index + 1])
        for index, (slide_id, _) in enumerate(clips)
    ]


def build_asset_manifest(
    *,
    run_id: str,
    paths: Paths,
    lesson: dict[str, Any],
    slide_assets: list[dict[str, Any]],
    segments: Sequence[Segment],
    voice: str,
    wpm: int,
    resolution: str,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "generator": "local_media_agent",
        "offline": True,
        "lesson_script": paths.lesson_script_path.name,
        "render": {"resolution": resolution, "voice": voice, "wpm": wpm},
        "assets": {
            "slide_images": slide_assets,
            "voiceover": {
                "path": relative_path(paths.run_root, paths.voiceover_path),
                "media_type": "audio/wav",
                "provider": "espeak-ng",
                "duration_seconds": segments[-1].end_seconds if segments else 0.0,
            },
        },
        "timings": [
            {
                "slide_id": segment.slide_id,
                "start_seconds": segment.start_seconds,
                "end_seconds": segment.end_seconds,
            }
            for segment in segments
        ],
    }


def relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


SELF_TEST_LESSON: dict[str, Any] = {
    "topic": "self test",
    "title": "Offline Media Agent Self Test",
    "learning_objective": "Confirm the offline renderer produces usable assets.",
    "audience": "pipeline maintainers",
    "duration_seconds": 15,
    "slides": [
        {
            "id": "slide-01",
            "title": "Rendering slides without any network access at all",
            "key_points": [
                "Pillow draws the title and the bullet list",
                "Supercalifragilisticexpialidociousunbreakablewordthatmustbesplit",
            ],
            "narration": "This is the first synthetic slide of the offline media agent self test.",
            "visual_brief": "Diagram of a local rendering pipeline.",
            "duration_seconds": 5,
        },
        {
            "id": "slide-02",
            "title": "Measuring narration length",
            "key_points": ["Durations come from the written wave frames, not a word count estimate"],
            "narration": "The second slide checks that measured timings line up with the audio.",
            "visual_brief": "Waveform aligned to slide boundaries.",
            "duration_seconds": 5,
        },
    ],
    "next_video": [
        {"label": "A", "direction": "Add motion between slides."},
        {"label": "B", "direction": "Swap espeak-ng for a neural voice."},
    ],
}


def run_self_test(args: argparse.Namespace) -> None:
    width, height = parse_resolution(args.resolution)
    with tempfile.TemporaryDirectory(prefix="local-media-agent-selftest-") as tmp:
        root = Path(tmp)
        script_path = root / "lesson-script-input.json"
        write_json(script_path, SELF_TEST_LESSON)
        output_dir = root / "run"

        run_args = argparse.Namespace(**vars(args))
        run_args.self_test = False
        run_args.script = script_path
        run_args.output_dir = output_dir
        run_args.run_id = "self-test"
        run_agent(run_args)
        # Re-running into the same directory must be safe and produce the same layout.
        run_agent(run_args)

        paths = build_paths(output_dir)
        check(paths.voiceover_path.is_file(), f"missing {paths.voiceover_path}")
        check(paths.timings_path.is_file(), f"missing {paths.timings_path}")
        check(paths.manifest_path.is_file(), f"missing {paths.manifest_path}")

        slide_paths = sorted(paths.slide_image_dir.glob("slide-*.png"))
        check(len(slide_paths) == 2, f"expected 2 slide images, found {len(slide_paths)}")
        for slide_path in slide_paths:
            with Image.open(slide_path) as image:
                check(
                    image.size == (width, height),
                    f"{slide_path.name} is {image.size}, expected {(width, height)}",
                )

        audio_seconds, peak = inspect_wav(paths.voiceover_path)
        check(audio_seconds > 0.5, f"voiceover is only {audio_seconds:.3f}s")
        check(peak > 0.02, f"voiceover looks silent (peak amplitude {peak:.4f})")

        document = json.loads(paths.timings_path.read_text(encoding="utf-8"))
        check(document.get("estimated") is False, "timings must be marked measured, not estimated")
        segments = document.get("segments") or []
        check(len(segments) == 2, f"expected 2 timing segments, found {len(segments)}")
        check(
            [segment["slide_id"] for segment in segments] == ["slide-01", "slide-02"],
            "timing segments are out of order",
        )
        check(float(segments[0]["start_seconds"]) == 0.0, "first segment must start at zero")
        for current, following in zip(segments, segments[1:]):
            check(
                float(current["end_seconds"]) == float(following["start_seconds"]),
                f"gap between {current['slide_id']} and {following['slide_id']}",
            )
            check(
                float(current["end_seconds"]) > float(current["start_seconds"]),
                f"{current['slide_id']} has non-positive duration",
            )
        drift = abs(float(segments[-1]["end_seconds"]) - audio_seconds)
        check(drift <= 0.15, f"timeline drifts {drift:.3f}s from the {audio_seconds:.3f}s audio")

        probed = ffprobe_duration(paths.voiceover_path)
        if probed is not None:
            check(
                abs(probed - audio_seconds) <= 0.15,
                f"ffprobe reports {probed:.3f}s but the wave header says {audio_seconds:.3f}s",
            )

    print(
        f"self-test passed: 2 slides at {width}x{height}, "
        f"{audio_seconds:.2f}s of measured narration",
    )


def inspect_wav(path: Path) -> tuple[float, float]:
    """Return (duration_seconds, peak_amplitude) with peak normalised to 0..1."""
    with contextlib.closing(wave.open(str(path), "rb")) as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        sample_width = audio.getsampwidth()
        payload = audio.readframes(frames)
    if sample_width != 2:
        raise AgentError(f"unexpected sample width {sample_width} in {path}")
    peak = max_abs_sample(payload)
    return frames / rate, peak / 32768.0


def max_abs_sample(payload: bytes) -> int:
    peak = 0
    for index in range(0, len(payload) - 1, 2):
        value = int.from_bytes(payload[index:index + 2], "little", signed=True)
        peak = max(peak, abs(value))
    return peak


def ffprobe_duration(path: Path) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AgentError(f"self-test failed: {message}")


if __name__ == "__main__":
    raise SystemExit(main())
