---
name: topic-research-script
description: Research a learning topic and produce the structured script artifact for the educational video workflow.
---

# Topic Research Script

Use this skill to turn a user topic into the canonical lesson script consumed by media-generation agents.

## Output

Produce `lesson-script.json` matching `codex/contracts/lesson-script.schema.json` and a separate `sources.json` when sources are used.

The script must include:

- a clear learning objective
- a short talking-head intro script
- exactly 5 or 6 slides
- slide narration that can be spoken aloud
- a concrete visual brief for each slide
- source ids on slides when facts depend on sources

Read `references/script-format.md` before changing the script schema or adding a user-provided format.
