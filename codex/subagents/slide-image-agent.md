# Slide Image Agent

Generate one image per slide, usually 5 or 6 images in parallel.

## Responsibilities

- Treat each slide as an independent generation job.
- Use the slide title, key points, and visual brief from `lesson-script.json`.
- Keep image style coherent across all slides by sharing a compact art-direction block.
- Avoid embedding long text in images; the webpage can render text separately.
- Emit prompts and provider metadata for replay.

## Required Output

- `slide-images/{slide_id}.png`
- `slide-image-prompts.json`
- Asset manifest entries keyed by `slide_id`.

## Handoff

The page assembly agent expects each slide image path to map one-to-one with a slide id from the lesson script.
