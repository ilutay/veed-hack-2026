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

Test or live — **use this exact form every time**:

```bash
WORKFLOW_MODE=live scripts/with-env.sh python3 codex/tools/fal_media_agent.py \
  --script artifacts/educational-video/{run_id}/lesson-script.json \
  --output-dir artifacts/educational-video/{run_id} \
  --run-id {run_id} \
  --mode live \
  --poll-interval-seconds 0.5
```

The agent calls `scripts/check-env.sh fal` before the first non-dry-run
provider request. Do not read `.env.local`.

### Why those two additions

**`WORKFLOW_MODE=live` is required even though `--mode live` is passed.**
`run_fal_preflight()` shells out to `scripts/check-env.sh` without forwarding the
run mode, and that script reads `WORKFLOW_MODE` from its environment (defaulting
to `dry-run`). Omit the variable and the preflight prints
`dry-run: no credentials required` and passes vacuously. The `FAL_KEY` check
immediately after still catches a missing key, so this is defence-in-depth rather
than a hole — but the guard does not fire without it.

**`--poll-interval-seconds 0.5` overrides a default of 2, which dominates
runtime.** A queue status round trip measures ~0.52s, so 0.5 is the practical
floor; below that the poll loop just issues back-to-back requests. Measured
across live runs, dropping 2 → 0.5 moved image collection from ~3.9s to ~2.4s.

## Performance

Measured over three live runs of a 6-slide, 15-second script:

| | |
|---|---|
| Total wall clock | 7.8–8.3s |
| Image inference (fal-reported) | 0.46–1.90s each, run concurrently |
| All images on disk | ~2.4s at 0.5s polling (~3.9s at the 2s default) |
| Voiceover result | 5.9–7.1s — the critical path |

Total runtime is gated by TTS generation, not by the image fan-out. Every image
is typically on disk while the voiceover is still generating. `xai/tts/v1`
returns no `timings` field, so its duration cannot be measured directly — only
bounded by which polls saw it incomplete then complete.

Further poll-interval tuning will not help. The remaining latency is ~1.9s of
HTTP round trips and ~1.2s of download, both irreducible under a queue-poll
design; the next real wins would be webhooks instead of polling, or a faster TTS
endpoint.

Completion *detection* is quantised to the poll grid and decoupled from real
inference time: across two runs whose image inference times differed by 4x, the
response files landed within 40ms of each other.

## Models

- Slide images: `fal-ai/z-image/turbo`
- Voiceover: `xai/tts/v1`

## Inputs

**Always pass canonical `lesson-script.json`.** The JSON path is the supported
one and preserves explicit per-slide `duration_seconds`, so
`narration-timings.json` reproduces the script's intended boundaries exactly.

Markdown full-script input is accepted only in a narrow form: each slide needs a
heading like `Slide 1: Title` — a separator and a title after the number — and
bare `Narration:` plus `Visual brief:` or `Visual:` field labels at the start of
a line.

**The Markdown renderings the script stage produces do not meet that form.** A
heading of `### Slide 1` has no separator or title, and fields written as
`* **Voiceover:**` carry bullet and bold decoration, so neither regex matches and
the run exits with "Markdown script must contain headings like 'Slide 1: Title'".

Two further hazards if Markdown is ever made to parse:

- **Duration ranges misparse.** `parse_duration` takes the first integer in the
  string, which for `0-2s` is the range *start*, then clamps it to a 5s minimum.
  A 15-second script parsed this way came out as 47 seconds.
- **Trailing sections are swallowed.** Any content after the last slide's final
  field — a "Next video" block, for instance — is appended to that slide's
  narration and will be spoken aloud.

Convert to JSON rather than working around these.

## Seeds and reruns

Image seeds derive from `run_id + slide_id`, so reusing a `run_id` reproduces the
same images from the same prompts. Use a fresh `run_id` to sample variation on an
unchanged brief.

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
