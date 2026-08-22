---
name: voiceover-video-generation
description: Generate or prepare the lesson voiceover video and slide timing metadata from a structured lesson script.
---

# Voiceover Video Generation

Use this skill for the narrated body of the educational video workflow.

## Behavior

- Build narration from slide scripts in order.
- Preserve slide boundaries for timing metadata.
- Use `codex/tools/fal_media_agent.py` for fal-backed generation.
- Use fal endpoint `xai/tts/v1` for a single combined TTS request.
- In dry-run mode, emit the narration payload and estimated timings.
- In test or live mode, run through `scripts/with-env.sh` and let the tool call
  `scripts/check-env.sh fal` before the first request.
- If the provider does not return slide timings, estimate from slide durations
  and mark the timing artifact as estimated.

## Output

- `voiceover.mp3`
- `narration-timings.json`

Read `references/voiceover-contract.md` when wiring a TTS, avatar, or video narration provider.
Read `../educational-video-workflow/references/fal-media-contract.md` before
changing fal model ids, payload fields, or artifact paths.
