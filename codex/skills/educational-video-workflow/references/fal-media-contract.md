# fal Media Contract

Use `codex/tools/fal_media_agent.py` for the `slide_images` and
`voiceover_video` branches.

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
- Voiceover: `xai/tts/v1`

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
combined `text`, `voice`, and `language`.

The current TTS provider does not return per-slide timings. Emit estimated
timings from slide durations and mark `narration-timings.json` as estimated.

## Outputs

- `lesson-script.json`
- `asset-manifest.json`
- `02-content-generation/slide-images/{slide_id}.png`
- `02-content-generation/slide-image-prompts.json`
- `02-content-generation/voiceover.mp3`
- `02-content-generation/voiceover-payload.json`
- `02-content-generation/narration-timings.json`
- sanitized provider metadata under `02-content-generation/provider/`
