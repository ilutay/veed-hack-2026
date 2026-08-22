# Script Format

The 15-second faceless educational video format. `SKILL.md` holds the generation prompt; this file
describes the artifact the prompt has to produce. Research lives in `research-brief.json`; this
stage only writes the script.

## Shape

- `topic`: from the brief.
- `title`: the video title.
- `learning_objective`: the brief's `concept`.
- `audience`: from the brief.
- `duration_seconds`: total duration, always `15`.
- `slides`: 5 or 6 slide objects in final playback order, whose durations sum to 15.
- `next_video`: 2 or 3 follow-up directions, labelled `A`, `B`, `C`, whose `direction` strings are
  the brief's `next_topics[].topic` values in order.
- `sources`: copy of the brief's `sources[]`, verbatim.
- `style_notes`: optional; explicit assumptions and production notes, including when the brief was
  a dry-run.
- `intro`: optional talking-head intro. The 15-second format has no room for one, so leave it out
  unless the caller explicitly asks for a presenter intro; the Veed stage is skipped when absent.

## Grounding

- Every narrated claim must trace to a `facts[]` entry with a `source_id`.
- Put that `source_id` on `slides[].source_ids`.
- Do not send a claim with no `source_id` to narration.
- Do not do web research in this stage.

## Writing Guidance

- Open on the hook. There is no runway for an introduction.
- Make every slide teach one small idea.
- Keep narration conversational, concise, and information-dense — roughly 2–3 seconds of speech per
  slide, so around 6–9 spoken words.
- Put image-generation instructions in `visual_brief`, not in narration. Keep the visuals simple
  enough to produce quickly; the education lives in the voiceover.
- Keep `next_video` options extremely simple and a natural continuation of the topic, so the format
  loops into the next video.
- Mark assumptions explicitly in `style_notes`.
