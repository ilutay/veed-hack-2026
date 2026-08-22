---
name: lesson-video
description: How to turn a lesson script into a finished mp4 through fal — the render chain and its directory layout, the slide-text composition step that keeps generated art from rendering misspelled words, and the failure modes that produce a wrong-looking video with exit 0. Use when rendering a lesson video, when slide text comes out garbled, when a rendered video has the wrong audio or the wrong length, or when wiring the bridge's /api/lesson job API to the UI.
---

# Lesson video

One way from `lesson-script.json` to `lesson-video.mp4`: fal for the assets,
`assemble_slideshow_video.py` to mux them.

| Path | Needs | Slides | Narration |
| --- | --- | --- | --- |
| fal | `FAL_KEY` | `fal-ai/z-image/turbo` art | `xai/tts/v1`, natural |

There is no credential-free path. `--mode dry-run` writes payload stubs and
deterministic artifact paths without calling the provider, which is enough to
exercise the job API but produces nothing the assembler can mux.

## Layout

```text
<run>/
|-- 01-script/lesson-script.json
|-- 02-content-generation/
|   |-- slide-images/slide-01.png ...
|   |-- voiceover.mp3
|   `-- narration-timings.json
`-- 03-video/
    |-- lesson-video.mp4
    `-- video-build.json
```

## Rendering

Always go through the runner so the key stays out of your shell history:

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

This step is **not yet wired into the bridge**, which calls the media agent and
then the assembler directly. A render started from `/api/lesson` therefore ships
whatever lettering z-image drew.

## Failure modes worth knowing

**Never reuse a `02-content-generation/` across runs.**
`assemble_slideshow_video.py` resolves audio as `(mp3, wav, m4a)` and takes the
first hit, so a stale `voiceover.mp3` silently outranks whatever a later run
writes. The result is a video built on the wrong audio, at the wrong length,
with exit 0 and no warning. The bridge is safe here only because it renders into
a fresh `<jobId>` directory every time.

**Slide ids become filenames.** They are used to build
`slide-images/<id>.png` and the provider metadata paths. The contract pins
`^slide-[0-9]{2}$`, but structured-output providers commonly ignore `pattern`,
and `fal_media_agent.py` only `setdefault`s a *missing* id — it never validates
one that is present. `assertSafeSlideIds` in `ui/server/bridge.mjs` re-checks the
script codex returns; that guard is the only thing between a model-authored id
and a write outside the run directory. Anything invoking the agent outside the
bridge has no such protection.

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

The media stage runs `--mode live` and bills per render; set
`LESSON_MEDIA_MODE=dry-run` to exercise the job API without spending, and expect
the assembly stage to fail.

The render takes minutes, so the job API never blocks — the same rule the
`tambo-veed-app` skill states for fal renders.
