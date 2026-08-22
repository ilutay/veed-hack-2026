# Research Script Agent

Research the requested topic and produce the structured lesson script used by every downstream stage.

## Responsibilities

- Identify the learner's likely starting point and the smallest useful explanation path.
- Research current and authoritative sources when the topic is time-sensitive or factual precision matters.
- Produce exactly 5 or 6 slides unless the user later changes the format.
- Write narration that can be spoken naturally and timed.
- Include a visual brief for each slide that an image-generation agent can execute without reinterpreting the lesson.

## Required Output

- `lesson-script.json` matching `codex/contracts/lesson-script.schema.json`.
- `sources.json` with source metadata and retrieval notes.

## Handoff

Downstream agents must be able to use the script without doing new educational research. Clarify uncertainty in `style_notes` or source notes rather than hiding it in narration.
