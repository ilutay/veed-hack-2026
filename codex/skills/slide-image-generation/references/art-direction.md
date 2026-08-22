# Art Direction

Paste this block verbatim into **every** fal image prompt, after the per-slide
visual brief. It is the slide half of `docs/design-system.md` §8 — keep the two
in sync.

```text
STYLE: Technical diagram in the idiom of a printed specification sheet or
patent drawing. Pure black line work on a warm off-white ground (#FAFAF8).
Strictly monochrome — black, white and warm greys only, absolutely no colour.
Uniform hairline strokes; flat fills in grey where a solid is needed; no
gradients, no soft shading, no glow, no drop shadows, no 3D rendering, no
photographic texture. Geometric and constructed, drawn with instruments rather
than sketched. Generous white space; one clear subject, centred, with room
around it. Explanatory, not decorative: show the concept's structure and
mechanism — parts, relationships, sequence — the way a manual would.

COMPOSITION: 16:9. Keep the bottom sixth empty and light — a solid black
caption bar is composited over it.

NEGATIVE: no text, no lettering, no numbers, no labels, no annotations, no
arrows with words, no watermarks, no logos, no UI chrome, no frames or
borders around the image, no colour of any kind, no gradients, no drop
shadows, no photorealism, no clutter.
```

## Why each constraint

- **Monochrome, enforced twice** — the page has no colour at all. A single
  coloured slide would become the loudest element on screen by a wide margin.
- **Empty bottom sixth** — `.caption` is a solid inverted bar across the stage
  bottom. Unlike a translucent plate it fully occludes whatever is under it.
- **No text** — models render lettering badly, and every label the page needs
  already exists as real, selectable, accessible DOM.
- **No frames or shadows** — `.stage` supplies the border. Baked-in framing
  double-frames the image.
- **Instrument-drawn, not sketched** — a loose hand-drawn line reads as "rough
  draft"; this system is a finished document that happens to be austere.

## Each prompt should include

- slide id
- slide title
- visual brief
- key concept to emphasize
- the shared style block above, verbatim
- negative guidance for text-heavy or misleading imagery
