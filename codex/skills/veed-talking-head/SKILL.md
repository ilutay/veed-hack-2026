---
name: veed-talking-head
description: Prepare or run the Veed.io talking-head intro generation stage for an educational video workflow.
---

# Veed Talking Head

Use this skill for the short presenter intro generated from
`lesson_script.intro.talking_head_script`. `intro` is optional and the
15-second lesson format normally omits it — skip this skill entirely when
`lesson-script.json` has no `intro` field.

The stage has two parts, run through two different providers:

1. **Intro audio (fal)** — already produced for you by
   `codex/tools/fal_media_agent.py` in the same `content_generation` pass that
   makes the slide images and voiceover. Nothing to do here except read the
   result; see [Output](#output).
2. **Intro video (VEED Fabric MCP)** — this skill's actual job. Call the
   `veed-fabric` MCP server's tools to turn the intro script into
   `talking-head-intro.mp4`, using a VEED stock avatar and VEED's own voice —
   **not** the fal audio clip. See [Behavior](#behavior) for why.

## Behavior

- Read `lesson_script.intro.talking_head_script` (the line an avatar should
  speak) and, if present, `lesson_script.intro.hook` for tone.
- In `dry-run`, do not call the `veed-fabric` MCP server at all. Emit the
  intended tool-call sequence and arguments (see the contract) as a JSON
  payload plus placeholder asset metadata.
- In `test` or `live`, drive the MCP tools in order — `list_characters` →
  `list_voices` → `confirm_fabric_video` → `create_fabric_video` →
  `get_generation_status` — and only call `create_fabric_video` after a user
  or work-order has confirmed the character/voice/cost. Poll
  `get_generation_status` until `completed` or `error`.
- Download the resulting video URL to `talking-head-intro.mp4` and write
  `talking-head-metadata.json` with the job id, chosen character/voice, and
  credit cost.
- Update `asset-manifest.json`: replace the `talking_head_intro` entry's
  `provider: "pending"` placeholder with the real path and provider metadata.
  Do not touch `talking_head_intro_audio` — that entry belongs to the fal
  stage.
- Do not hide MCP errors (insufficient credits, generation failure, empty
  voice locale). Report them; do not silently fall back to a placeholder.

## Why two providers for one clip

The VEED Fabric MCP server (`https://www.veed.io/api/v1/mcp`) generates video
from `script + voiceId + characterId` — it does its own text-to-speech with a
VEED stock avatar and has no parameter for supplying a pre-rendered audio
file. It is a different product surface from the `veed/fabric-1.0` fal
endpoint (image + audio → video), which this skill does **not** use.

So the fal-generated `talking-head-intro-audio.mp3` is not fed into the MCP
call. It exists as: a fast, credential-light way to hear and time the intro
line before spending VEED credits, and a fallback artifact if the MCP call is
unavailable. Keep both artifacts in the manifest; do not delete the fal audio
once the video exists.

## Output

- `talking-head-intro-audio.mp3` — fal-generated, produced upstream by
  `fal_media_agent.py`. Registered as `assets.talking_head_intro_audio`.
- `talking-head-intro.mp4` — this skill's output (or a placeholder path in
  `dry-run`). Registered as `assets.talking_head_intro`.
- `talking-head-metadata.json` — provider, MCP tool-call sequence, job id,
  chosen character/voice ids, credit cost, and output path.

## MCP setup

The `veed-fabric` MCP server is pre-wired in this repo — `.mcp.json` for
Claude Code, `.codex/config.toml` for Codex CLI — and needs a one-time OAuth
login per developer, not an API key. See "MCP servers" in `AGENTS.md` before
running this skill in `test` or `live` mode.

Read `references/veed-contract.md` for the exact tool names, arguments, and
metadata fields.
