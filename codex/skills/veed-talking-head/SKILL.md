---
name: veed-talking-head
description: Prepare or run the talking-head intro generation stage for an educational video workflow, using fal's veed/fabric-1.0 model.
---

# Veed Talking Head

Use this skill for the short presenter intro generated from
`lesson_script.intro.talking_head_script`. `intro` is optional and the
15-second lesson format normally omits it — skip this skill entirely when
`lesson-script.json` has no `intro` field.

This stage now runs entirely through **fal**, in the same
`codex/tools/fal_media_agent.py` invocation used for slide images and
voiceover — there is nothing separate to drive turn-by-turn. See "Content
Generation Concurrency" in
`../educational-video-workflow/references/workflow-contract.md` for how this
stage fits alongside the slide/voiceover branch.

The stage has three fal requests, all handled by `fal_media_agent.py`:

1. **Intro audio** (`fal-ai/minimax/speech-2.6-turbo`) — the line the avatar
   will speak, timed and previewable independent of the video render.
2. **Presenter avatar image** (`fal-ai/z-image/turbo`) — a fixed-seed
   headshot, reused across runs so the presenter looks the same every time
   (see [Default avatar](#default-avatar)).
3. **Talking-head video** (`veed/fabric-1.0`) — turns the avatar image plus
   the intro audio into `talking-head-intro.mp4`. This is an
   image+audio→video model: it lip-syncs the avatar to the given audio clip
   rather than doing its own text-to-speech, so it depends on both of the
   requests above completing first.

## Behavior

- Read `lesson_script.intro.talking_head_script` (the line an avatar should
  speak) and, if present, `lesson_script.intro.hook` for tone.
- In `dry-run`, do not call fal. `fal_media_agent.py` still emits the intended
  avatar-image and video request payloads (with `image_url`/`audio_url` left
  `null`, since nothing has actually been generated) as
  `talking-head-avatar-payload.json` and `talking-head-video-payload.json`.
- In `test` or `live`, `fal_media_agent.py` submits the avatar image and
  intro audio jobs in parallel with the slide images and voiceover, waits for
  both to complete, then submits the `veed/fabric-1.0` job with their fal
  URLs and polls it to completion.
- Download the resulting video to `talking-head-intro.mp4` and write
  `talking-head-metadata.json` with the job id, resolution, and output path.
- `asset-manifest.json`'s `talking_head_intro` entry is filled in directly by
  `fal_media_agent.py` once the video completes — no separate skill needs to
  patch it afterward. It only stays a `provider: "pending"` placeholder in
  `dry-run` or when `intro` is absent.
- Do not hide provider errors (failed generation, missing URLs in a
  response). Report them; do not silently fall back to a placeholder.

## Default avatar

`fal_media_agent.py` generates the avatar image with a fixed prompt and a
seed derived from a constant key (not the run id), so the same presenter
appears across runs instead of a new face each time — the fal equivalent of
the old fixed `character-19` default. To use a different look for a specific
run, change `DEFAULT_AVATAR_PROMPT` / `DEFAULT_AVATAR_SEED_KEY` in
`codex/tools/fal_media_agent.py`, or swap in a pre-made image by editing
`build_avatar_image_payload` to point at a fixed `image_url` instead of
generating one.

## Output

- `talking-head-intro-audio.mp3` — registered as `assets.talking_head_intro_audio`.
- `talking-head-avatar.png` — the presenter image fed into `veed/fabric-1.0`,
  registered as `assets.talking_head_avatar`.
- `talking-head-intro.mp4` — this stage's final output (or a placeholder path
  in `dry-run`). Registered as `assets.talking_head_intro`.
- `talking-head-metadata.json` — provider, endpoint, job id, resolution, and
  output path for the video request.

Read `references/veed-contract.md` for the exact request/response shape of
`veed/fabric-1.0`.
