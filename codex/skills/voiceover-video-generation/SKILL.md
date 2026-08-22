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
- Use fal endpoint `fal-ai/minimax/speech-2.6-turbo` for a single combined TTS
  request, with `voice_setting.voice_id` `Friendly_Person` and
  `voice_setting.emotion` `happy` by default.
- In dry-run mode, emit the narration payload and estimated timings.
- In test or live mode, run through `scripts/with-env.sh` and let the tool call
  `scripts/check-env.sh fal` before the first request.
- If the provider does not return slide timings, estimate from slide durations
  and mark the timing artifact as estimated.

## Output

- `voiceover.mp3`
- `narration-timings.json`

`voiceover.mp3` and `narration-timings.json` feed `../slideshow-video-assembly`,
which renders the mp4 locally. Timings that do not match the real audio length
are fitted there, so mark estimates honestly rather than rounding them to the
scripted duration.

Read `references/voiceover-contract.md` when wiring a TTS, avatar, or video narration provider.
Read `../educational-video-workflow/references/fal-media-contract.md` before
changing fal model ids, payload fields, or artifact paths.
