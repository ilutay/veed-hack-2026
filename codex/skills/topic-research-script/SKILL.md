---
name: topic-research-script
description: Turn a topic into a 15-second faceless educational video script with 5-6 slides and a next-video choice, then emit it as the structured script artifact for the educational video workflow.
---

# Topic Research Script

Use this skill to turn a user topic into the canonical lesson script consumed by media-generation agents.

## Inputs

- **Topic:** what the video is about
- **Information:** key facts, ideas, or educational points to cover
- **Context:** additional direction, audience, or goals

## Generation Prompt

You are creating a **15-second faceless YouTube educational video**.

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
- Use the provided information accurately; don't invent facts
- The video should teach **one clear concept or takeaway**
- End with a simple interactive choice between **2–3 directions** for the next video
- The choices should naturally continue the topic and create a repeatable content loop
- Don't overload the ending — keep the options extremely simple

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

Research current and authoritative sources when the topic is time-sensitive or when factual
precision matters, and record what you used. Do not narrate the research in the script itself.

## Output

Produce `lesson-script.json` matching `codex/contracts/lesson-script.schema.json` and a separate
`sources.json` when sources are used. Downstream agents read the JSON, not the prose script, so the
prose and the artifact must agree exactly.

Field mapping from the script format:

| Script field | Artifact field |
| --- | --- |
| Title | `title` |
| Slide Duration | `slides[].duration_seconds` (sums to `duration_seconds`, 15) |
| Slide Image | `slides[].visual_brief` |
| Slide Voiceover | `slides[].narration` |
| Next video A/B/C | `next_video[]` |

Read `references/script-format.md` before changing the artifact shape.
