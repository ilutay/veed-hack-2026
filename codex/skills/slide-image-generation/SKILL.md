---
name: slide-image-generation
description: Generate or prepare 5-6 parallel slide image jobs for the educational video workflow.
---

# Slide Image Generation

Use this skill to create the image assets for each slide in `lesson-script.json`.

## Behavior

- Fan out one job per slide.
- Use `codex/tools/fal_media_agent.py` for fal-backed generation.
- Use fal endpoint `fal-ai/z-image/turbo`.
- Keep prompts deterministic and tied to slide ids.
- Share a compact visual style across all slide prompts.
- Avoid putting dense text in generated images.
- Emit provider metadata and prompts even in dry-run mode.
- In `test` or `live`, run through `scripts/with-env.sh` and let the tool call
  `scripts/check-env.sh fal` before the first request.

## Output

- `slide-images/{slide_id}.png`
- `slide-image-prompts.json`
- asset entries in `asset-manifest.json`

Read `references/art-direction.md` when creating or revising the visual style.
Read `../educational-video-workflow/references/fal-media-contract.md` before
changing fal model ids, payload fields, or artifact paths.
