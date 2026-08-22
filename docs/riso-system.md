# Riso System

The visual and behavioural spec for the learning page. Single source of truth for
`page/riso.css`; also the shared style block the `slide_images` stage pastes into
prompts, replacing the placeholder in
`codex/skills/slide-image-generation/references/art-direction.md`.

Two audiences, two sections. §1–§5 are for the page. §6 is for image prompts and
is written to be lifted verbatim.

---

## 1. Inks

Risograph printing lays flat, opaque spot inks on absorbent paper. There are no
gradients inside an ink and no soft shadows — depth comes from overlap,
misregistration and halftone density.

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#F4EFE4` | The ground. Warm, never pure white. |
| `--ink-red` | `#F24B4B` | Primary. Hook, active state, the "now" slide. |
| `--ink-blue` | `#008CC4` | Secondary. Structure, chrome, progress. |
| `--ink-yellow` | `#F2A900` | Highlight. Never for text on paper — fails contrast. |
| `--ink-violet` | `#4C3A8C` | Body text and the intro segment. |
| `--ink-green` | `#009E73` | Confirmation, "applied" direction. |
| `--ink-pink` | `#E04B8C` | Accent, "wider" direction. |
| `--soot` | `#1A1614` | Near-black for long-form text. Not `#000`. |

Rules:

- **Two inks per view, three at most.** A riso print is limited by drum count;
  that limit is the whole look. More inks reads as generic flat design.
- **Text on paper is `--soot` or `--ink-violet`.** Yellow and green never carry
  body copy.
- **Knock out, don't tint.** Light text on an ink block is `--knockout`, not
  white and not a lightened ink.
- **Text on an ink never follows the theme.** `--paper` and `--body` swap in dark
  mode; a saturated ink does not. Use `--knockout` (always light) on a dark ink
  and `--on-ink` (always dark) on a light one such as yellow. Using `--paper` for
  a caption is the bug this rule exists to prevent — it renders dark-on-red in
  dark mode.

### Dark mode

Riso is a paper medium; a "dark riso" is a fiction. Rather than invert, swap the
ground to `--soot-paper` `#171310` and let the inks stay saturated — the same
prints under a different light. Body text becomes `--paper`.

```css
:root { --paper:#F4EFE4; --body:#1A1614; /* …inks… */ }
:root:not([data-theme="light"]) { @media (prefers-color-scheme: dark) {
  --paper:#171310; --body:#F4EFE4; } }
:root[data-theme="dark"] { --paper:#171310; --body:#F4EFE4; }
```

## 2. Grain

Every surface carries paper tooth. One shared overlay, not a per-element filter.

- SVG `feTurbulence` (`baseFrequency 0.8`, `numOctaves 4`) at 4–7% opacity,
  `mix-blend-mode: multiply`, `position: fixed`, `pointer-events: none`.
- It sits above content and below nothing. `z-index` 9999.
- **`prefers-reduced-motion` does not disable grain** — it is static texture, not
  motion. Only the shimmer in §5 respects that flag.

## 3. Halftone

Density, not opacity, expresses value. A tinted region is a dot field of one ink.

- CSS `radial-gradient` dot at `--halftone-cell` (default `6px`), dot radius
  scaled `0.1`–`0.45` of the cell.
- Use for: image mattes, the progress track, card fills behind text.
- **Never behind body copy below 16px.** The dots and the letterforms interfere.

## 4. Misregistration

The signature. A second impression, 2–3px off-axis, in a contrasting ink.

- Display type only — headings, slide titles, button labels. Never body text.
- Offset `--misreg: 2px`; the ghost sits *under* the primary, up and left.
- Implemented with `text-shadow`, so it costs nothing and never reflows:
  `text-shadow: calc(-1*var(--misreg)) calc(-1*var(--misreg)) 0 var(--ghost);`
- One direction per view. Randomising per element reads as a bug.

## 5. Type and motion

**Type.** A chunky grotesque for display, a plain system stack for body. Display
is set tight (`letter-spacing:-0.02em`), uppercase, and large — 
`clamp(2rem, 6vw, 4.5rem)` for the lesson title. Body never exceeds 68 characters
per line.

**Motion vocabulary.** Four moves, nothing else:

| Move | Where | Spec |
| --- | --- | --- |
| **snap-in** | slide change, card entry | `160ms cubic-bezier(.2,.9,.3,1.4)`, from `translateY(8px) rotate(-.6deg)` to rest. Overshoot is the point. |
| **ink-bleed** | hover on choices | halftone cell grows `6px→7px` over `220ms`; the fill appears to soak. |
| **grain-shimmer** | idle, ambient | overlay `background-position` drifts 2px over 8s. **Disabled under `prefers-reduced-motion`.** |
| **press** | any button | `scale(.97) translateY(1px)`, `90ms`. Every interactive element has one. |

`prefers-reduced-motion: reduce` → snap-in becomes an opacity fade, shimmer stops,
press becomes a border change. Nothing becomes instant-and-jarring.

---

## 6. Style block for slide-image prompts

*Lift this section verbatim into image-generation prompts. It replaces the
placeholder direction in `art-direction.md`.*

```
STYLE: Risograph print illustration. Two spot inks only, drawn from this palette:
warm off-white paper #F4EFE4 ground, with #F24B4B red, #008CC4 blue, #F2A900
yellow, #4C3A8C violet, #009E73 green. Flat opaque areas of colour with visible
halftone dot texture; no gradients, no soft shadows, no photographic lighting.
Deliberate 2-3px misregistration between the two ink layers. Bold simple shapes,
generous negative space, thick confident linework. Slight paper grain throughout.

COMPOSITION: One clear subject, centred or on a third. Leave the lower third and
the upper-left corner uncluttered — the webpage renders the slide title and
captions over those areas.

NEGATIVE: no text, no words, no numbers, no labels, no charts with axis
annotations, no watermarks, no photorealism, no 3D render, no drop shadows, no
gradient meshes, no busy backgrounds, no small detail that disappears at 400px
wide.
```

Per-prompt, append: slide id, slide title, the `visual_brief`, and the single
concept the slide teaches. Keep the two chosen inks **consistent across all
slides in one lesson** — vary composition, not palette.

---

## 7. Playback timing model

Not decoration — this determines the player's structure, so it is specified here
rather than discovered in code.

**The problem.** `narration-timings.json` may carry `"estimated": true`
(`voiceover-contract.md` explicitly permits it), and slide `duration_seconds`
comes from the script author's guess, not from the rendered audio. A 15-second
script whose TTS returns 19 seconds leaves every boundary after the first wrong.

**The rules.**

1. **Drive from `audio.currentTime`, never a `setTimeout` chain.** A timer
   accumulates error and desynchronises on pause, seek, and tab blur.
2. **Scale estimated timings to the real audio.** On `loadedmetadata`, if the
   manifest says `estimated` or the timing span disagrees with `audio.duration`
   by more than 0.5s, multiply every boundary by
   `audio.duration / timedSpan`. An over-long track then stretches
   proportionally instead of truncating the final slide.
3. **Manual navigation is always live.** `page-contract.md` requires
   "synchronized **or manually navigable**" — that is explicit permission to
   degrade. Prev/next and a slide counter are present in every state, including
   when audio is missing entirely.
4. **Branch on `media_type`, not the file extension.** The manifest is the
   authority; fixtures are `audio/wav`, real runs are `video/mp4`.
5. **Placeholder assets are flagged in the UI**, per `page-contract.md` — a
   corner tag, never hidden.

**The test that proves it.** Re-encode the fixture voiceover to 19s and point the
player at it unchanged. All six slides must still play, and the last must end
with the audio. If that needs a code change, the model was wrong.
