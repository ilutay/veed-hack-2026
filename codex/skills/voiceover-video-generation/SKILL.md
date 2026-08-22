---
name: voiceover-video-generation
description: Generate or prepare the lesson voiceover video and slide timing metadata from a structured lesson script.
---

# Voiceover Video Generation

Use this skill for the narrated body of the educational video workflow.

## Behavior

- Build narration from slide scripts in order.
- Preserve slide boundaries for timing metadata.
- In dry-run mode, emit the narration payload and estimated timings.
- In test or live mode, use the configured provider API or MCP tool.

## Output

- `voiceover.mp4`
- `narration-timings.json`

Read `references/voiceover-contract.md` when wiring a TTS, avatar, or video narration provider.
