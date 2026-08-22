# Video Assembly Contract

## Stage Position

`content_generation` produces stills, audio, and timings. This stage turns those
into one playable file. It reads only files, calls no provider, and is safe to
rerun: same inputs and flags produce the same output.

Suggested artifact path, alongside the existing stage dirs:

```text
artifacts/educational-video/{run_id}/03-video/lesson-video.mp4
artifacts/educational-video/{run_id}/03-video/video-build.json
```

## Input Contract

- Slide images live in one flat directory. The file stem is the `slide_id`
  (`slide-01.png` -> `slide-01`), matching the `^slide-[0-9]{2}$` pattern used by
  `codex/contracts/asset-manifest.schema.json`.
- Narration timings follow `codex/skills/voiceover-video-generation/references/voiceover-contract.md`:
  an `estimated` boolean and ordered `segments` of `slide_id`, `start_seconds`,
  `end_seconds`.
- Segments are sorted by `start_seconds` before rendering. Each segment's
  duration is `end_seconds - start_seconds`; a non-positive duration is an error.
- Images with no timing entry are skipped with a warning. Timing entries with no
  image are a hard error — a silently dropped slide is worse than a failed render.

## Duration Rule

The voiceover file's `ffprobe` duration is authoritative. The video is exactly as
long as the narration; slide boundaries move to fit it, never the other way
round. This is why `--timing-fit` exists rather than a `-shortest` truncation:
truncating would cut narration, and padding the tail would leave dead air.

Fit is skipped entirely when the timeline is within 0.25s of the audio.

## Filter Graph

Each still becomes an input held for its own duration, plus the crossfade tail it
hands to the next slide:

```text
[N:v]scale=W:H:force_original_aspect_ratio=decrease,
     pad=W:H:(ow-iw)/2:(oh-ih)/2:color=BG,
     setsar=1,fps=FPS,format=yuv420p[vN]
```

Then either `concat=n=N:v=1:a=0` (no crossfade) or a chain of `xfade` filters
whose offsets are the cumulative slide durations. Audio is the last input,
mapped straight through to AAC 192k. `+faststart` keeps the file streamable.

`decrease` + `pad` is deliberate: slides are letterboxed, never cropped or
stretched, so a provider that returns an off-spec aspect ratio degrades visibly
rather than silently distorting the art.

## Build Report

`video-build.json` records what was rendered, not what was requested:

- `output`, `audio`, `audio_duration_seconds`
- `timings_source`: the timings path, or `even-split` when none was supplied
- `timing_fit_applied`: `none`, `scale`, or `pad-last`
- `resolution`, `fps`, `crossfade_seconds`
- `segments`: the post-fit `slide_id`, `image`, `start_seconds`, `end_seconds`

Downstream stages (webpage assembly, QA) should read the report rather than
re-deriving timings from `narration-timings.json`, which may have been fitted.

## Adding a Transition or Motion Effect

Extend the filter graph in `codex/tools/assemble_slideshow_video.py`, keep the
per-segment durations authoritative, and add the new parameter to the build
report. Any effect that consumes time must subtract it from a neighbouring slide
so the total still equals the audio duration.
