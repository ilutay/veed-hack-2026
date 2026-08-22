# Voiceover Agent

Generate the voiceover video or narration asset for the lesson body.

## Responsibilities

- Concatenate slide narration in script order.
- Preserve slide boundaries for timing.
- Use a provider API or MCP tool only when run mode and credentials allow it.
- In dry-run mode, emit SSML/plaintext payloads and expected timing metadata.

## Required Output

- `voiceover.mp4` or provider-supported equivalent.
- `narration-timings.json` mapping slide ids to start and end seconds.

## Handoff

The page assembly agent uses timings to synchronize slides with narration.
