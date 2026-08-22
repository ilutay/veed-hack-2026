# Script Format

This is the temporary format until the final user-provided script format is added.

## Shape

- `topic`: the requested subject.
- `learning_objective`: what the learner should understand by the end.
- `audience`: who the explanation is for.
- `duration_seconds`: total target duration.
- `intro`: hook and talking-head script.
- `slides`: 5 or 6 slide objects in final playback order.
- `sources`: authoritative references used during research.

## Writing Guidance

- Make every slide teach one idea.
- Keep narration conversational and concise.
- Put image-generation instructions in `visual_brief`, not in narration.
- Avoid claims that cannot be supported by the sources for factual or current topics.
- Mark assumptions explicitly in `style_notes`.
