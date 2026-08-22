---
name: slideshow-video-assembly
description: Render the final lesson video locally with ffmpeg by combining slide images, the voiceover audio, and narration timings JSON from a content-generation run.
---

# Slideshow Video Assembly

Use this skill when the user wants the actual video file — not the webpage — out
of a finished `content_generation` stage. It is the free, local, offline half of
the pipeline: ffmpeg only, no provider calls, no credentials, no run mode gate.

## Inputs

A content-generation stage directory, e.g.
`artifacts/educational-video/{run_id}/02-content-generation`:

| File | Required | Purpose |
| --- | --- | --- |
| `slide-images/slide-NN.png` | yes | One still per slide; stem must match a `slide_id`. |
| `voiceover.mp3` (or `.wav`, `.m4a`) | yes | The narration. Its real length defines the video length. |
| `narration-timings.json` | no | Slide boundaries. Without it, slides split the audio evenly. |

`codex/examples/sample-slides-run/02-content-generation` is a real six-slide run
you can use as input to test any change to this skill.

## Behavior

1. Resolve inputs from `--content-dir`, or point at each file individually.
2. Probe the voiceover with `ffprobe`; the audio is the source of truth for duration.
3. Reconcile the slide timeline against that duration — see the fit policies below.
4. Render with a single ffmpeg pass: scale and pad each still to the output frame,
   concat (or crossfade) them, mux the original audio.
5. Write `video-build.json` beside the output with the timeline actually rendered.

## Run it

```bash
python3 codex/tools/assemble_slideshow_video.py \
  --content-dir codex/examples/sample-slides-run/02-content-generation \
  --output artifacts/educational-video/sample/03-video/lesson-video.mp4
```

Useful flags:

| Flag | Default | Notes |
| --- | --- | --- |
| `--resolution` | `1920x1080` | Slides are letterboxed, never stretched. |
| `--fps` | `30` | |
| `--crossfade-seconds` | `0` | Must be shorter than the shortest slide. |
| `--background` | `black` | Pad colour for non-matching aspect ratios. |
| `--timing-fit` | `auto` | See below. |
| `--print-command` | off | Print the ffmpeg command and exit; use it to explain or hand-tune a render. |
| `--overwrite` | off | Required to replace an existing output. |

## Timing fit

Estimated timings routinely disagree with the real narration length — the sample
run declares a 15s timeline against 32.6s of audio. Never render that mismatch
directly; slides would end two thirds of the way through the voiceover.

- `auto` (default): scale when the timings are marked `"estimated": true`, pad the
  last slide when they are measured.
- `scale`: stretch every segment proportionally to the audio duration.
- `pad-last`: keep every boundary, absorb the difference in the final slide.
- `strict`: fail on a mismatch over 0.25s. Use once a provider returns real timings.

The applied policy is reported on stderr and recorded in `video-build.json`.

## Constraints

- Do not re-encode or resample the voiceover beyond the AAC mux; narration timing
  is the one thing a viewer notices.
- Do not invent slides. A `slide_id` in the timings with no matching image is an
  error, not a gap to fill with black.
- Keep the output under the run directory so it stays replayable and gitignored.

Read `references/video-assembly-contract.md` before changing the filter graph,
the fit policies, or the build report shape.
