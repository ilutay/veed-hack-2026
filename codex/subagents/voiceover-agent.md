# Voiceover Agent

Generate the voiceover video or narration asset for the lesson body.

## Responsibilities

- Concatenate slide narration in script order.
- Preserve slide boundaries for timing.
- Use `codex/tools/fal_media_agent.py` for fal-backed voiceover generation.
- Use a provider API only when run mode and credentials allow it.
- In dry-run mode, emit SSML/plaintext payloads and expected timing metadata.
- For non-dry-runs, call the tool through `scripts/with-env.sh` so `FAL_KEY`
  is scoped to the child process.

## Required Output

- `02-content-generation/voiceover.mp3`.
- `02-content-generation/voiceover-payload.json`.
- `02-content-generation/narration-timings.json` mapping slide ids to start and end seconds.

## Handoff

The page assembly agent uses timings to synchronize slides with narration.
