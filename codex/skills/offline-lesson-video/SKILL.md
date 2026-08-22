---
name: offline-lesson-video
description: How to turn a lesson script into a finished mp4 on this machine — the offline PIL+espeak-ng path that needs no provider credentials, the fal path to prefer when FAL_KEY is present, and the slide-text composition step that keeps generated art from rendering misspelled words. Use when rendering a lesson video, when FAL_KEY is missing or you are told to stay in dry-run, when slide text comes out garbled, when a rendered video has the wrong audio or the wrong length, or when wiring the bridge's /api/lesson job API to the UI.
---

# Offline lesson video

Two ways to get from `lesson-script.json` to `lesson-video.mp4`. Both end in the
same assembler and the same directory layout, so the UI does not care which ran.

| Path | Needs | Slides | Narration |
| --- | --- | --- | --- |
| offline | nothing | `local_media_agent.py`, PIL-drawn | `espeak-ng`, synthetic |
| fal | `FAL_KEY` | `fal-ai/z-image/turbo` art | `xai/tts/v1`, natural |

The offline path is the fallback when no credential is available. It calls no
external provider, so `WORKFLOW_MODE` stays `dry-run` and nothing is billed.

## Layout both paths produce

```text
<run>/
|-- 01-script/lesson-script.json
|-- 02-content-generation/
|   |-- slide-images/slide-01.png ...
|   |-- voiceover.wav          # offline;  voiceover.mp3 from fal
|   `-- narration-timings.json
`-- 03-video/
    |-- lesson-video.mp4
    `-- video-build.json
```

## Offline path

```bash
python3 codex/tools/local_media_agent.py \
    --script <run>/01-script/lesson-script.json --output-dir <run>
python3 codex/tools/assemble_slideshow_video.py \
    --content-dir <run>/02-content-generation \
    --output <run>/03-video/lesson-video.mp4 --timing-fit auto
```

`local_media_agent.py --self-test` renders a synthetic two-slide lesson and
checks the outputs; run it first when something looks wrong.

Timings are **measured** from the generated audio, not estimated, so
`narration-timings.json` carries `"estimated": false` and the assembler pads
rather than scales. A consequence worth expecting: a script declaring
`duration_seconds: 15` renders to roughly 23 seconds, because espeak-ng is
slower than the contract's word budget. The audio is the source of truth.

Prerequisites: `ffmpeg`, `ffprobe`, `espeak-ng`, python `PIL`, and
`fonts-dejavu-core`. There is no emoji or CJK font on this box, so those
characters render as tofu boxes — harmless, but model-authored `key_points`
often carry emoji.

## fal path, when FAL_KEY is present

Better art and a natural voice. Always go through the runner so the key stays
out of your shell history:

```bash
WORKFLOW_MODE=live scripts/with-env.sh python3 codex/tools/fal_media_agent.py \
    --script <run>/01-script/lesson-script.json --output-dir <run> \
    --image-size portrait_16_9 --mode live
```

Check the key first with `scripts/with-env.sh scripts/check-env.sh fal`.
`check-env.sh` alone reads only the process environment and will report
`MISSING` even when `.env` defines the key — the runner is what loads the files.

### Do not let the image model draw the slide text

`fal_media_agent.py` puts `Slide title:` and `Key points:` into the image prompt,
so the model renders that text — and diffusion models misspell lettering.
Observed on a real run: "niarrow" for "narrow", "Iterrate on winners", "that
wored mareds mcbrie iopit". This also contradicts the tool's own
`DEFAULT_ART_DIRECTION`, which asks the model to "leave open space for webpage
title and caption overlays".

Two steps fix it. Generate art from a variant script whose `title` is a purely
visual subject and whose `key_points` is empty, leaving no text to draw. Then
composite the real wording locally, where it is exact:

```bash
python3 codex/tools/compose_slide_text.py \
    --script    <run>/01-script/lesson-script.json \
    --art-dir   <run>/02-content-generation/slide-images \
    --output-dir <run>/02-content-generation/slide-images-composed \
    --resolution 1080x1920
python3 codex/tools/assemble_slideshow_video.py \
    --slides-dir <run>/02-content-generation/slide-images-composed \
    --audio      <run>/02-content-generation/voiceover.mp3 \
    --timings    <run>/02-content-generation/narration-timings.json \
    --output     <run>/03-video/lesson-video.mp4 \
    --resolution 1080x1920 --timing-fit auto
```

`compose_slide_text.py` draws an **opaque** title band rather than a translucent
scrim, because the model still slips occasional lettering into the art even when
told not to, and a see-through panel lets that show behind the real title.

## Failure modes worth knowing

**Never mix a fal run and a local run in one `02-content-generation/`.**
`assemble_slideshow_video.py` resolves audio as `(mp3, wav, m4a)` and takes the
first hit, so a `voiceover.mp3` left by a fal run silently outranks the
`voiceover.wav` a later local run writes. The result is a video built on the
wrong audio, at the wrong length, with exit 0 and no warning.
`local_media_agent.py` deletes those siblings before synthesising, but a fal run
into a directory holding a stale wav has no such guard.

**Slide ids become filenames.** `local_media_agent.py` rejects any id that is not
a plain filename. The contract pins `^slide-[0-9]{2}$`, but structured-output
providers commonly ignore `pattern` and the bridge does not re-validate the
script it gets back, so that check is the only thing between a model-authored id
and a write outside the run directory.

**Timings that disagree with the audio.** `--timing-fit auto` scales estimated
timings and pads measured ones. `strict` fails instead, which is what you want in
CI. `video-build.json` records the fit that was chosen and the audio it used —
read it before believing a suspicious render.

## Reaching it from the UI

`ui/server/bridge.mjs` exposes the whole chain as a job:
`POST /api/lesson {topic}` returns a `jobId` immediately, `GET /api/lesson/:id`
reports `scripting` -> `media` -> `assembly` -> `completed`, and the finished mp4
is served from `/media/lessons/<jobId>/03-video/lesson-video.mp4` with HTTP range
support so a `<video>` element can seek. The `LessonVideo` Tambo component polls
that endpoint. See `ui/README.md` for the component and registry side.

The render takes minutes, so the job API never blocks — the same rule the
`tambo-veed-app` skill states for fal renders.
