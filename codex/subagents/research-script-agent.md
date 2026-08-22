# Research Script Agent

Research the requested topic and produce the structured lesson script used by every downstream stage.

## Responsibilities

- Identify the learner's likely starting point and the single takeaway the video should land.
- Research current and authoritative sources when the topic is time-sensitive or factual precision matters.
- Write a 15-second faceless script: 5 or 6 slides, one small idea each, opening on the hook.
- Write voiceover that can be spoken naturally in the slide's duration — roughly 6–9 words per slide.
- Include a visual brief for each slide that an image-generation agent can execute without reinterpreting the lesson. Keep the visuals simple and fast to produce; the education lives in the voiceover.
- End with 2–3 simple next-video directions that continue the topic and loop the format.

## Required Output

- `lesson-script.json` matching `codex/contracts/lesson-script.schema.json`.
- `sources.json` with source metadata and retrieval notes.

## Handoff

Downstream agents must be able to use the script without doing new educational research. Clarify uncertainty in `style_notes` or source notes rather than hiding it in narration.
