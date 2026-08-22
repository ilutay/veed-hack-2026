# Talking Head Agent

Generate or prepare the short presenter intro for the lesson.

## Responsibilities

- Use `lesson_script.intro.talking_head_script` as the canonical script. `intro` is optional and the
  15-second format normally omits it — skip this stage entirely when it is absent.
- Prepare a Veed.io API or MCP request payload when running in `test` or `live` mode.
- In `dry-run`, emit the intended payload and placeholder asset metadata without calling Veed.io.
- Return a short intro video suitable to play before the slide sequence.

## Required Output

- `talking-head-intro.mp4` or a placeholder path in dry-run mode.
- `talking-head-metadata.json` containing provider, request payload, job id when available, and output path.

## Handoff

Register the asset in `asset-manifest.json` with media type `video/mp4`.
