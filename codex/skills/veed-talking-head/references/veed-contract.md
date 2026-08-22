# Veed Contract

Video generation goes through the **VEED Fabric MCP server**
(`https://www.veed.io/api/v1/mcp`, Streamable HTTP, OAuth 2.0 per developer —
see "MCP servers" in `AGENTS.md`), called directly by the agent, not by a
Python script with an API key. There is no `VEED_API_KEY`.

Server and tool details below were current as of 2026-08-22, sourced from
`https://veedstudio.github.io/veed-fabric-mcp/tools-reference.html`. Re-check
that page (or `codex mcp list` / `claude mcp list` tool descriptions) if a
call is rejected for an unknown field — VEED's schema is not vendored here.

## Default character and voice

Unless a work order or user names a different character/voice for the run,
skip `list_characters`/`list_voices` and use these ids directly:

- `characterId`: `"character-19"` (male avatar, chosen 2026-08-22 by
  eyeballing `list_characters` thumbnails)
- `voiceId`: `"en-CA-LiamNeural"` (male, English (Canada) — the first
  general-purpose English male voice returned by `list_voices({locale: "en",
  gender: "Male"})`; no `en-US` male voice was on the first two result pages)

This is a fixed default for unattended `test`/`live` runs, not a
per-conversation "auto-pick something" instruction — reuse the same two ids
every time rather than re-deriving them, so repeated runs are reproducible.
Re-run `list_characters`/`list_voices` (see [Tool sequence](#tool-sequence))
only when asked to use a different character or voice.

## Tool sequence

Call in this order. Do not skip `confirm_fabric_video` — it is the only place
the cost is shown before credits are spent. Steps 1–2 are skipped when using
the default character/voice above.

1. **`list_characters`** — optional `gender` filter (`"male"` \| `"female"`).
   Returns avatar `id`s. Pick one, or surface the carousel for a human to
   pick.
2. **`list_voices`** — required `locale` (e.g. `"en"`, `"en-GB"`, `"fr"`),
   optional `gender` filter (`"Female"` \| `"Male"` \| `"Neutral"`). Derive
   `locale` from the lesson's language; default `"en"`. Returns voice `id`s.
3. **`confirm_fabric_video`** — `script`, `voiceId`, `characterId`, optional
   `workspaceId`, `aspectRatio` (`"landscape"` \| `"portrait"` \| `"square"`,
   default landscape — use `"landscape"` to match the slide webpage unless
   told otherwise). Returns an estimated credit cost. In an unattended `test`/
   `live` run, treat this as a hard preflight: abort if
   `get_credit_balance` shows fewer credits than the estimate.
4. **`create_fabric_video`** — same arguments as step 3, plus optional
   `projectId`. Costs **~8 credits per second of output**. Returns `jobId`,
   `workspaceId`, `projectId`.
5. **`get_generation_status`** — poll with `jobId` until `status` is
   `completed` (returns a video URL) or `error`. Typical generation time is
   1–2 minutes.

Auxiliary tools, call as needed rather than in the fixed sequence:

- **`list_workspaces`** — only if the account has more than one workspace and
  `workspaceId` needs to be chosen explicitly.
- **`get_credit_balance`** — optional `workspaceId`. Check before a long
  script, or when `confirm_fabric_video`'s estimate is close to the balance.

## Script input

`script` is `lesson_script.intro.talking_head_script`, unmodified. VEED
performs its own text-to-speech from this string using the chosen `voiceId` —
it does not accept an external audio file. See the "Why two providers"
section in `../SKILL.md` for how this relates to the fal-generated
`talking-head-intro-audio.mp3`.

## Dry-run payload

In `dry-run`, do not call any `veed-fabric` tool. Emit the intended sequence
as `talking-head-request.json`:

```json
{
  "mode": "dry-run",
  "server": "veed-fabric",
  "calls": [
    { "tool": "list_characters", "arguments": {} },
    { "tool": "list_voices", "arguments": { "locale": "en" } },
    {
      "tool": "confirm_fabric_video",
      "arguments": { "script": "...", "voiceId": null, "characterId": null, "aspectRatio": "landscape" }
    },
    {
      "tool": "create_fabric_video",
      "arguments": { "script": "...", "voiceId": null, "characterId": null, "aspectRatio": "landscape" }
    },
    { "tool": "get_generation_status", "arguments": { "jobId": null } }
  ]
}
```

`voiceId`, `characterId`, and `jobId` are `null` because nothing has actually
been listed or created yet — filling them in would misrepresent a call that
never happened.

## Minimum Metadata Fields

Write to `talking-head-metadata.json`:

- `provider`: `veed-fabric-mcp`
- `mode`: `dry-run`, `test`, or `live`
- `character_id`, `voice_id`, `workspace_id` (as selected/returned)
- `job_id` (from `create_fabric_video`)
- `estimated_cost_credits` (from `confirm_fabric_video`)
- `output_path`
- `status` (from `get_generation_status`)

Do not hide provider errors. Preserve raw MCP tool responses (redact nothing
except credentials, and there are none in these responses) in the stage
directory.
