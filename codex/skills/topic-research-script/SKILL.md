---
name: topic-research-script
description: Turn a research-brief.json into a 15-second faceless educational video script with 5-6 slides and a next-video choice. Does not do web research.
---

# Topic Research Script

Use this skill to turn a **research brief** into the canonical lesson script consumed by media-generation agents.

This stage does **not** search the web. `topic_research` already did that. If a fact is missing from the brief, omit it; do not invent a replacement and do not open a browser.

## Inputs

- **research-brief.json** (required): `00-topic-research/research-brief.json` matching `codex/contracts/research-brief.schema.json`
- **topic** / **audience**: use the brief's values unless the caller explicitly overrides audience

## Generation Prompt

You are creating a **15-second faceless YouTube educational video** from a grounded research brief.

Generate a complete video script optimized for **high educational value and fast-paced visual storytelling**.

### Rules

- Total duration: **15 seconds**
- Use **5–6 slides**
- Keep slides visually simple and quick to produce
- Prioritize **voiceover and actual education**, not visual effects
- Each slide should communicate **one small idea**
- Keep the voiceover concise, natural, and information-dense
- Start immediately with a strong hook
- Avoid generic introductions, filler, and repetition
- Use **only** claims that appear in `facts[]`. A claim with no `source_id` must not reach narration.
- Copy `facts[].source_id` onto `slides[].source_ids` for every slide that uses that fact.
- Copy `sources[]` through **verbatim**. Do not rename ids, titles, or URLs.
- Map `concept` → `learning_objective`.
- Map `next_topics` → `next_video`: labels `A` / `B` / `C` in order; `direction` is the next-topic's `topic` string (the brief's `deeper|wider|applied` enum stays on the brief).
- Honour `misconceptions`: if the brief says the sourced figure is 600% not 400%, narrate 600%.
- The video should teach **one clear concept or takeaway** (the brief's `concept`)
- End with the brief's 2–3 next-topic directions. Don't invent extra ones.
- Don't overload the ending — keep the options extremely simple
- If `research.mode` is `dry-run` or `test`, still write a real script from the brief, but do not pretend the brief was live-researched; say so in `style_notes` when the brief already does.

### Script format

```
**Title**

**Slide 1**
- Duration:
- Image:
- Voiceover:

... (through Slide 5 or Slide 6)

**Next video**
- A — ...
- B — ...
- C — ...
```

## Output

Produce `lesson-script.json` matching `codex/contracts/lesson-script.schema.json`. Downstream agents read the JSON, not the prose script, so the prose and the artifact must agree exactly. A separate `sources.json` is optional and must be identical to `lesson-script.sources`.

Field mapping from the script format:

| Script field     | Artifact field                                               |
| ---------------- | ------------------------------------------------------------ |
| Title            | `title`                                                      |
| Slide Duration   | `slides[].duration_seconds` (sums to `duration_seconds`, 15) |
| Slide Image      | `slides[].visual_brief`                                      |
| Slide Voiceover  | `slides[].narration`                                         |
| Next video A/B/C | `next_video[]`                                               |

Brief → script mapping:

| Brief field           | Script field             |
| --------------------- | ------------------------ |
| `concept`             | `learning_objective`     |
| `facts[].source_id`   | `slides[].source_ids`    |
| `sources[]`           | `sources[]` (verbatim)   |
| `next_topics[].topic` | `next_video[].direction` |
| `audience`            | `audience`               |
| `topic`               | `topic`                  |

Read `references/script-format.md` before changing the artifact shape.
