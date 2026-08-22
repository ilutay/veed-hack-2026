#!/usr/bin/env python3
"""Render a slideshow video from slide images, a voiceover, and slide timings.

This is the local, free half of the pipeline: no provider calls, no credentials,
just ffmpeg. It consumes a content-generation stage directory
(`slide-images/`, `voiceover.mp3`, `narration-timings.json`) and produces an
mp4 plus a `video-build.json` report describing the timeline it actually used.

Estimated timings routinely disagree with the real narration length, so the
timeline is reconciled against the audio duration before anything is rendered.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Sequence


DEFAULT_TIMINGS_NAME = "narration-timings.json"
DEFAULT_SLIDES_DIRNAME = "slide-images"
DEFAULT_AUDIO_NAMES = ("voiceover.mp3", "voiceover.wav", "voiceover.m4a")
DEFAULT_REPORT_NAME = "video-build.json"
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
# Below this, a timeline/audio mismatch is rounding noise rather than a problem.
FIT_TOLERANCE_SECONDS = 0.25
MIN_SEGMENT_SECONDS = 0.1


class AssemblyError(RuntimeError):
    """Raised for expected failures the operator needs to fix."""


@dataclass(frozen=True)
class Segment:
    slide_id: str
    start_seconds: float
    end_seconds: float
    image: Path

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Combine slide images and a voiceover into an mp4 using ffmpeg.",
    )
    parser.add_argument(
        "--content-dir",
        type=Path,
        help=(
            "Content-generation stage directory holding slide-images/, "
            "voiceover.*, and narration-timings.json."
        ),
    )
    parser.add_argument("--slides-dir", type=Path, help="Override slide image directory.")
    parser.add_argument("--audio", type=Path, help="Override voiceover audio file.")
    parser.add_argument("--timings", type=Path, help="Override narration timings JSON.")
    parser.add_argument("--output", type=Path, required=True, help="Output .mp4 path.")
    parser.add_argument(
        "--report",
        type=Path,
        help=f"Build report path (default: {DEFAULT_REPORT_NAME} beside the output).",
    )
    parser.add_argument("--no-report", action="store_true", help="Skip the build report.")
    parser.add_argument(
        "--resolution",
        default="1920x1080",
        help="Output resolution as WIDTHxHEIGHT (default: 1920x1080).",
    )
    parser.add_argument("--fps", type=int, default=30, help="Output frame rate (default: 30).")
    parser.add_argument(
        "--background",
        default="black",
        help="Pad colour for slides that do not match the output aspect ratio.",
    )
    parser.add_argument(
        "--crossfade-seconds",
        type=float,
        default=0.0,
        help="Crossfade between slides; consumes time from both neighbours (default: 0).",
    )
    parser.add_argument(
        "--timing-fit",
        choices=("auto", "scale", "pad-last", "strict"),
        default="auto",
        help=(
            "Reconcile timings with real audio length: scale stretches every "
            "segment, pad-last absorbs the difference in the final slide, "
            "strict fails, auto scales estimated timings and pads measured ones "
            "(default: auto)."
        ),
    )
    parser.add_argument(
        "--print-command",
        action="store_true",
        help="Print the resolved ffmpeg command and exit without rendering.",
    )
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing output file.")
    return parser.parse_args(argv)


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise AssemblyError(f"{name} not found on PATH; install ffmpeg first.")
    return path


def resolve_inputs(args: argparse.Namespace) -> tuple[Path, Path, Path | None]:
    """Return (slides_dir, audio, timings) from --content-dir plus overrides."""
    content_dir = args.content_dir
    if content_dir is not None and not content_dir.is_dir():
        raise AssemblyError(f"content dir not found: {content_dir}")

    slides_dir = args.slides_dir
    if slides_dir is None:
        if content_dir is None:
            raise AssemblyError("pass --content-dir or --slides-dir.")
        slides_dir = content_dir / DEFAULT_SLIDES_DIRNAME
    if not slides_dir.is_dir():
        raise AssemblyError(f"slide image directory not found: {slides_dir}")

    audio = args.audio
    if audio is None:
        if content_dir is None:
            raise AssemblyError("pass --content-dir or --audio.")
        audio = next(
            (content_dir / name for name in DEFAULT_AUDIO_NAMES if (content_dir / name).is_file()),
            None,
        )
        if audio is None:
            raise AssemblyError(
                f"no voiceover audio in {content_dir}; expected one of {', '.join(DEFAULT_AUDIO_NAMES)}."
            )
    if not audio.is_file():
        raise AssemblyError(f"voiceover audio not found: {audio}")

    timings = args.timings
    if timings is None and content_dir is not None:
        candidate = content_dir / DEFAULT_TIMINGS_NAME
        timings = candidate if candidate.is_file() else None
    if timings is not None and not timings.is_file():
        raise AssemblyError(f"narration timings not found: {timings}")

    return slides_dir, audio, timings


def slide_images(slides_dir: Path) -> dict[str, Path]:
    images = {
        path.stem: path
        for path in sorted(slides_dir.iterdir())
        if path.suffix.lower() in IMAGE_SUFFIXES
    }
    if not images:
        raise AssemblyError(f"no slide images in {slides_dir}")
    return images


def probe_duration_seconds(path: Path) -> float:
    ffprobe = require_binary("ffprobe")
    result = subprocess.run(
        [
            ffprobe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssemblyError(f"ffprobe failed on {path}: {result.stderr.strip()}")
    try:
        return float(result.stdout.strip())
    except ValueError as error:
        raise AssemblyError(f"ffprobe returned no duration for {path}") from error


def load_segments(timings_path: Path | None, images: dict[str, Path]) -> tuple[list[Segment], bool]:
    """Return (segments, estimated). Without timings, slides split the audio evenly."""
    if timings_path is None:
        return [
            Segment(slide_id, float(index), float(index + 1), path)
            for index, (slide_id, path) in enumerate(sorted(images.items()))
        ], True

    document = json.loads(timings_path.read_text())
    raw_segments = document.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise AssemblyError(f"{timings_path} has no segments array.")

    segments: list[Segment] = []
    for entry in raw_segments:
        slide_id = entry.get("slide_id")
        image = images.get(slide_id)
        if image is None:
            raise AssemblyError(
                f"{slide_id} has timings but no image in the slide directory "
                f"(have: {', '.join(sorted(images))})."
            )
        start = float(entry["start_seconds"])
        end = float(entry["end_seconds"])
        if end <= start:
            raise AssemblyError(f"{slide_id} ends at or before it starts ({start} -> {end}).")
        segments.append(Segment(slide_id, start, end, image))

    segments.sort(key=lambda segment: segment.start_seconds)
    return segments, bool(document.get("estimated", False))


def fit_segments(
    segments: list[Segment],
    audio_seconds: float,
    policy: str,
    estimated: bool,
) -> tuple[list[Segment], str]:
    """Reconcile the slide timeline with the real audio length."""
    timeline_seconds = segments[-1].end_seconds
    if timeline_seconds <= 0:
        raise AssemblyError("slide timeline has zero length.")

    drift = audio_seconds - timeline_seconds
    if abs(drift) <= FIT_TOLERANCE_SECONDS:
        return segments, "none"

    if policy == "strict":
        raise AssemblyError(
            f"timeline is {timeline_seconds:.2f}s but audio is {audio_seconds:.2f}s "
            f"({drift:+.2f}s); rerun with --timing-fit scale or pad-last."
        )

    effective = policy
    if policy == "auto":
        effective = "scale" if estimated else "pad-last"

    if effective == "scale":
        factor = audio_seconds / timeline_seconds
        return [
            replace(
                segment,
                start_seconds=segment.start_seconds * factor,
                end_seconds=segment.end_seconds * factor,
            )
            for segment in segments
        ], "scale"

    last = segments[-1]
    end = max(audio_seconds, last.start_seconds + MIN_SEGMENT_SECONDS)
    return segments[:-1] + [replace(last, end_seconds=end)], "pad-last"


def parse_resolution(value: str) -> tuple[int, int]:
    try:
        width, height = (int(part) for part in value.lower().split("x", 1))
    except ValueError as error:
        raise AssemblyError(f"invalid --resolution {value!r}; expected WIDTHxHEIGHT.") from error
    if width <= 0 or height <= 0:
        raise AssemblyError(f"invalid --resolution {value!r}; dimensions must be positive.")
    return width, height


def build_ffmpeg_command(
    segments: list[Segment],
    audio: Path,
    output: Path,
    *,
    width: int,
    height: int,
    fps: int,
    background: str,
    crossfade: float,
    overwrite: bool,
) -> list[str]:
    if crossfade < 0:
        raise AssemblyError("--crossfade-seconds cannot be negative.")
    shortest = min(segment.duration_seconds for segment in segments)
    if crossfade > 0 and crossfade >= shortest:
        raise AssemblyError(
            f"--crossfade-seconds {crossfade} does not fit the shortest slide ({shortest:.2f}s)."
        )

    command = [require_binary("ffmpeg"), "-y" if overwrite else "-n"]
    last_index = len(segments) - 1
    for index, segment in enumerate(segments):
        # Each still is held for its own slide time plus the crossfade tail it
        # hands to the next slide.
        hold = segment.duration_seconds + (0.0 if index == last_index else crossfade)
        command += ["-loop", "1", "-t", f"{hold:.3f}", "-i", str(segment.image)]
    command += ["-i", str(audio)]

    filters = [
        f"[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={background},"
        f"setsar=1,fps={fps},format=yuv420p[v{index}]"
        for index in range(len(segments))
    ]

    if len(segments) == 1:
        video_label = "v0"
    elif crossfade > 0:
        offset = 0.0
        current = "v0"
        for index in range(1, len(segments)):
            offset += segments[index - 1].duration_seconds
            label = f"x{index}"
            filters.append(
                f"[{current}][v{index}]xfade=transition=fade:"
                f"duration={crossfade:.3f}:offset={offset:.3f}[{label}]"
            )
            current = label
        video_label = current
    else:
        streams = "".join(f"[v{index}]" for index in range(len(segments)))
        filters.append(f"{streams}concat=n={len(segments)}:v=1:a=0[vout]")
        video_label = "vout"

    command += [
        "-filter_complex", ";".join(filters),
        "-map", f"[{video_label}]",
        "-map", f"{len(segments)}:a",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(output),
    ]
    return command


def build_report(
    segments: list[Segment],
    *,
    audio: Path,
    audio_seconds: float,
    output: Path,
    timings_path: Path | None,
    fit_applied: str,
    width: int,
    height: int,
    fps: int,
    crossfade: float,
) -> dict[str, Any]:
    return {
        "output": str(output),
        "audio": str(audio),
        "audio_duration_seconds": round(audio_seconds, 3),
        "timings_source": str(timings_path) if timings_path else "even-split",
        "timing_fit_applied": fit_applied,
        "resolution": f"{width}x{height}",
        "fps": fps,
        "crossfade_seconds": crossfade,
        "segments": [
            {
                "slide_id": segment.slide_id,
                "image": str(segment.image),
                "start_seconds": round(segment.start_seconds, 3),
                "end_seconds": round(segment.end_seconds, 3),
            }
            for segment in segments
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        width, height = parse_resolution(args.resolution)
        slides_dir, audio, timings_path = resolve_inputs(args)
        images = slide_images(slides_dir)
        segments, estimated = load_segments(timings_path, images)

        unused = sorted(set(images) - {segment.slide_id for segment in segments})
        if unused:
            print(f"warning: slide images without timings, skipped: {', '.join(unused)}", file=sys.stderr)

        audio_seconds = probe_duration_seconds(audio)
        segments, fit_applied = fit_segments(segments, audio_seconds, args.timing_fit, estimated)
        if fit_applied != "none":
            print(
                f"timing fit: {fit_applied} (audio {audio_seconds:.2f}s, "
                f"{len(segments)} slides)",
                file=sys.stderr,
            )

        args.output.parent.mkdir(parents=True, exist_ok=True)
        command = build_ffmpeg_command(
            segments,
            audio,
            args.output,
            width=width,
            height=height,
            fps=args.fps,
            background=args.background,
            crossfade=args.crossfade_seconds,
            overwrite=args.overwrite,
        )

        if args.print_command:
            print(" ".join(command))
            return 0

        if args.output.exists() and not args.overwrite:
            raise AssemblyError(f"{args.output} exists; pass --overwrite to replace it.")

        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            raise AssemblyError(f"ffmpeg exited with {result.returncode}.")

        report = build_report(
            segments,
            audio=audio,
            audio_seconds=audio_seconds,
            output=args.output,
            timings_path=timings_path,
            fit_applied=fit_applied,
            width=width,
            height=height,
            fps=args.fps,
            crossfade=args.crossfade_seconds,
        )
        if not args.no_report:
            report_path = args.report or args.output.parent / DEFAULT_REPORT_NAME
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
            print(f"wrote {report_path}", file=sys.stderr)
        print(f"wrote {args.output}", file=sys.stderr)
        return 0
    except AssemblyError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
