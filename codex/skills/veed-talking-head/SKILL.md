---
name: veed-talking-head
description: Prepare or run the Veed.io talking-head intro generation stage for an educational video workflow.
---

# Veed Talking Head

Use this skill for the short presenter intro generated from `lesson_script.intro.talking_head_script`.

## Behavior

- In `dry-run`, emit a Veed request payload and placeholder metadata only.
- In `test`, use configured Veed sandbox or MCP test tools.
- In `live`, call production Veed APIs only when credentials and user intent are explicit.

## Output

- `talking-head-intro.mp4`
- `talking-head-metadata.json`

Read `references/veed-contract.md` when wiring the actual Veed API or MCP tool.
