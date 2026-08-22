# fal Media Contract

Use `codex/tools/fal_media_agent.py` for the `slide_images` and
`voiceover_video` branches, and for all three requests behind
`talking_head_intro` — intro audio, the presenter avatar image, and the
`veed/fabric-1.0` video itself. See
`../../veed-talking-head/references/veed-contract.md` for the video request
shape.

## Command

Dry-run:

```bash
python3 codex/tools/fal_media_agent.py \
  --script artifacts/educational-video/{run_id}/lesson-script.json \
  --output-dir artifacts/educational-video/{run_id} \
  --run-id {run_id}
```

Test or live:

```bash
WORKFLOW_MODE=live scripts/with-env.sh python3 codex/tools/fal_media_agent.py \
  --script artifacts/educational-video/{run_id}/lesson-script.json \
  --output-dir artifacts/educational-video/{run_id} \
  --run-id {run_id} \
  --mode live
```

The agent calls `scripts/check-env.sh fal` before the first non-dry-run
provider request. Do not read `.env.local`.

## Models

- Slide images: `fal-ai/z-image/turbo`
- Voiceover: `fal-ai/minimax/speech-2.6-turbo`
- Talking-head intro audio: `fal-ai/minimax/speech-2.6-turbo` (same endpoint as
  voiceover, one short request instead of the combined slide narration)
- Talking-head presenter avatar image: `fal-ai/z-image/turbo` (same endpoint
  as slides, fixed prompt/seed so the presenter is consistent across runs)
- Talking-head video: `veed/fabric-1.0` — image+audio→video; takes the avatar
  image and intro audio above and returns a lip-synced video

## Inputs

The preferred input is canonical `lesson-script.json`. Markdown full-script input
is also accepted when each slide uses a heading like `Slide 1: Title` and
contains `Narration:` plus `Visual brief:` or `Visual:`.

## Image Requests

Submit one queue job per slide in parallel. Defaults:

- `image_size`: `landscape_16_9`
- `num_inference_steps`: `8`
- `num_images`: `1`
- `output_format`: `png`
- `enable_safety_checker`: `true`
- `enable_prompt_expansion`: `false`
- `seed`: stable hash of `run_id + slide_id`

## Voiceover Request

Submit one queue job for the combined slide narration. The local payload keeps
ordered `segments` for timing and replay, while the provider payload sends the
combined `prompt` plus the MiniMax voice settings. Defaults:

- `voice_setting.voice_id`: `Friendly_Person`
- `voice_setting.emotion`: `happy`
- `voice_setting.speed`: `1.2` (`--speed` / `FAL_TTS_SPEED`) — faster than
  MiniMax's natural 1.0 pace. The 15-second script format has no slack for
  real-time narration; measured audio at `speed=1.0` has come back 2-3x the
  scripted 15s. Raise further if narration still overruns the slide timeline.
- `language_boost`: mapped from the `--language` code (`en` -> `English`,
  unknown codes -> `auto`)
- `output_format`: `url`

Narration is capped at 5,000 characters per request; longer lessons need split
generation.

The current TTS provider does not return per-slide timings. Emit estimated
timings from slide durations and mark `narration-timings.json` as estimated.

## Talking-Head Intro Audio Request

Submit a second, independent queue job to the same
`fal-ai/minimax/speech-2.6-turbo` endpoint when
`lesson_script.intro` is present, built from
`intro.talking_head_script` alone (not joined with the slide narration).
`target_duration_seconds` defaults to 5 (`--intro-seconds` /
`FAL_INTRO_SECONDS`) and is advisory only, exactly like the per-slide
`target_duration_seconds` hints — the provider does not enforce it.

This clip is also the exact `audio_url` input fed into the `veed/fabric-1.0`
request below — unlike the old MCP-based flow, nothing here regenerates the
speech.

## Talking-Head Avatar Image Request

Submit a third queue job to `fal-ai/z-image/turbo` when `lesson_script.intro`
is present, using a fixed prompt and a seed derived from a constant key (not
`run_id`), so the same presenter face appears across runs. Runs in parallel
with everything else — it does not depend on the audio job.

## Talking-Head Video Request

Once the avatar image and intro audio jobs above have both completed, submit
one `veed/fabric-1.0` request with their fal-hosted URLs:

```json
{ "image_url": "<avatar image url>", "audio_url": "<intro audio url>", "resolution": "720p" }
```

`resolution` defaults to `720p` (`--video-resolution` / `FAL_VIDEO_RESOLUTION`,
also accepts `480p`). Poll like every other fal request and download the
response's `video.url` to `talking-head-intro.mp4`. The avatar and audio URLs
carry signed tokens — pass them straight through in memory and never write
them to disk; only the redacted submit/response JSON and the downloaded files
are persisted.

## Outputs

- `lesson-script.json`
- `asset-manifest.json`
- `02-content-generation/slide-images/{slide_id}.png`
- `02-content-generation/slide-image-prompts.json`
- `02-content-generation/voiceover.mp3`
- `02-content-generation/voiceover-payload.json`
- `02-content-generation/talking-head-intro-audio.mp3` (only when `intro` is present)
- `02-content-generation/talking-head-intro-audio-payload.json` (only when `intro` is present)
- `02-content-generation/talking-head-avatar.png` (only when `intro` is present)
- `02-content-generation/talking-head-avatar-payload.json` (only when `intro` is present)
- `02-content-generation/talking-head-intro.mp4` (only when `intro` is present)
- `02-content-generation/talking-head-video-payload.json` (only when `intro` is present)
- `02-content-generation/talking-head-metadata.json` (only when `intro` is present, `test`/`live` only)
- `02-content-generation/narration-timings.json`
- sanitized provider metadata under `02-content-generation/provider/`
