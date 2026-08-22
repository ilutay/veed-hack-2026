# Taste Labs — Design System

**Status: single source of truth.** Read this before touching any CSS, any component in `src/components/`, or any slide-image prompt.

Reference: the `PIONEER//GYM` wireframe. This system takes that drawing literally — its austerity is the aesthetic, not a placeholder for one.

This document supersedes:

| File | Disposition |
|---|---|
| `docs/riso-system.md` | **Superseded.** Archive it. The Risograph direction is retired. |
| `page/riso.css` | **Superseded.** `page/` may stay as a fixture harness, but it is no longer "the design source". |
| `src/styles/riso.css` | **To be rewritten** against this file. |
| `codex/skills/ui/skills/tambo-veed-app/SKILL.md` item 6 | Repoint here. |
| `codex/skills/learning-page-assembly/references/page-contract.md` L11 | Repoint here. |
| `codex/skills/slide-image-generation/references/art-direction.md` | Replace with §8. |

---

## The direction in one paragraph

A technical document, not an app. Ink on paper: near-black type on warm off-white, structure drawn with hairline rules and boxes rather than cards and shadows. Depth appears exactly once, as a **hard offset shadow with no blur** — a print-registration idiom, not a glow. Corners are square. There is **no colour at all**; emphasis comes from weight, rule thickness, and inversion — a black box with white text is the loudest thing the system can say. Two voices share the page: a **human voice** in bold grotesk and grey prose, and a **machine voice** in Syne Mono for anything the system generated, measured, or is waiting on. The reader should feel they are looking at an instrument's readout.

---

## §1 Foundations

```css
:root {
  /* ---- Ground & surfaces ---- */
  --ground:  #FAFAF8;   /* the page */
  --surface: #FFFFFF;   /* panels, cards, the stage */
  --fill:    #EFEDE8;   /* inset fields, active step, highlighted row */
  --ink-fill: #111111;  /* inverted blocks: black box, white text */

  /* ---- Ink ---- */
  --ink:       #111111; /* headings, body, borders that matter */
  --ink-muted: #6B6862; /* prose, subtitles, kv labels */
  --ink-faint: #8C887F; /* meta, disabled, tick marks — 3:1, never body copy */
  --on-ink:    #FFFFFF; /* text inside an --ink-fill block */

  /* ---- Rules ---- */
  --line:        #D8D6D0; /* decorative hairline: grouping, separators */
  --line-strong: #8F8B82; /* interactive boundaries — meets 3:1 */
  /* --ink doubles as the emphasis rule */

  --bw-hair: 1px;
  --bw-bold: 2px;

  /* ---- The one shadow ---- */
  --shadow-hard:   6px 6px 0 var(--ink);
  --shadow-hard-sm: 3px 3px 0 var(--ink);
  /* no blur, no spread, no alpha. There is no second shadow. */

  /* ---- Radii ---- */
  --r-none: 0;      /* the default for everything */
  --r-sm:   2px;    /* buttons, inputs, state boxes — barely there */
  --r-pill: 9999px; /* the status chip and step numerals ONLY */

  /* ---- Spacing: 4px base, dense ---- */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-7: 32px;
  --sp-8: 40px;
  --sp-9: 56px;

  /* ---- Motion ---- */
  --dur-fast: 100ms;
  --dur-base: 150ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* ---- Layout ---- */
  --container:  min(1280px, 96vw);
  --rail-width: 280px;
  --measure:    68ch;
}
```

**Light only.** This is a paper-and-ink idiom: hard offset shadows and hairline rules are print moves that fall apart on a dark ground. Do not add a dark theme, and do not add `prefers-color-scheme` blocks. Set `body { background: var(--ground); color: var(--ink); }` explicitly.

**No colour.** There is no accent token, no hue, no semantic palette. If a state needs to stand out it inverts (`--ink-fill` + `--on-ink`) or thickens its rule to `--bw-bold`. A request for "just one accent colour" is a change to this document, not a local decision.

### Contrast, verified 2026-08-22

| Pair | Ratio | Requirement |
|---|---|---|
| `--ink` on `--ground` | 18.07 | 4.5 ✓ |
| `--ink-muted` on `--surface` | 5.55 | 4.5 ✓ |
| `--ink-muted` on `--fill` | 4.75 | 4.5 ✓ |
| `--ink-faint` on `--surface` | 3.53 | 3.0 ✓ (meta only) |
| `--on-ink` on `--ink-fill` | 18.88 | 4.5 ✓ |
| `--line-strong` on `--surface` | 3.40 | 3.0 ✓ |
| `--line` on `--surface` | **1.45** | decorative only |

> **`--line` is invisible to WCAG.** At 1.45:1 it may group and separate, but it must never be the *only* thing marking an interactive control's boundary or a state change. Control edges use `--line-strong` or `--ink`. This is the single easiest rule to break in a system made mostly of borders.

---

## §2 Typography

```css
  --font-display: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; /* 600–700 */
  --font-body:    "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; /* 400 */
  --font-mono:    "Syne Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

### Two voices

**Human voice — Inter.** Anything a person wrote or reads as a sentence: headings (600/700), prose (400, `--ink-muted`), button labels, step titles, flow node names.

**Machine voice — Syne Mono.** Anything the system emitted, measured, or is waiting on: eyebrow labels, state boxes, key/value readouts, step numerals, tab labels, proof rows, run ids, counters, receipts, timing notes, `no_component_yet`-style tokens.

The split is the point. If you cannot tell which voice something is, ask who authored it: a human or the pipeline.

**Syne Mono ships a single 400 weight** — no bold, no italic, no variable axis. Google Fonts returns the same 400 TTF for any weight requested (verified 2026-08-22). Never set `font-weight` or `font-variation-settings` on it; the browser will synthesise a smeared faux-bold. Mono emphasis comes from **case, tracking, and inversion** instead.

### Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne+Mono&family=Inter:opsz,wght@14..32,400..700&display=swap" />
```

Two families, nothing else. Drop Space Grotesk, Space Mono and Syne (the proportional one). **Delete the inline `<style>` block in `index.html`** that re-declares `--font-*` — stacks are declared once, in `:root`.

### Scale

| Role | Face | Size | Weight | Tracking | Case |
|---|---|---|---|---|---|
| `.display` (h1) | Inter | `1.625rem` / 1.2 | 700 | `-0.01em` | sentence |
| h2 | Inter | `1.375rem` / 1.25 | 700 | `-0.01em` | sentence |
| h3 / panel title | Inter | `1.0625rem` / 1.3 | 600 | `0` | sentence |
| body | Inter | `0.9375rem` / 1.55 | 400 | `0` | sentence |
| small | Inter | `0.8125rem` / 1.45 | 400 | `0` | sentence |
| `.eyebrow` | **Syne Mono** | `0.6875rem` / 1.3 | 400 | `+0.12em` | UPPER |
| `.meta` | **Syne Mono** | `0.75rem` / 1.4 | 400 | `+0.04em` | as-is |
| `.micro` | **Syne Mono** | `0.6875rem` / 1.4 | 400 | `+0.02em` | as-is |

Sentence case for human voice; UPPERCASE reserved for eyebrows, tabs and state boxes. Prose caps at `--measure`. Every numeral that updates gets `font-variant-numeric: tabular-nums`.

---

## §3 The three structural moves

Everything in §4 is assembled from these. Learn them once.

**1. The box.** A rectangle with a `--bw-hair` `--line` border on `--surface`, square corners, `--sp-4` to `--sp-5` padding. This is the default container. It does not have a shadow. Nesting boxes is normal and expected.

**2. The inversion.** `background: var(--ink-fill); color: var(--on-ink)`. The system's only emphasis. Used for: the active tab, the step numeral, the primary button, the selected chip. Never more than **two inversions visible at once** — a third makes the page look broken rather than emphatic.

**3. The offset.** `border: var(--bw-bold) solid var(--ink); box-shadow: var(--shadow-hard)`. Reserved for surfaces that are *currently live*: the focused work card, the active decision panel. **At most one `--shadow-hard` per column.** It is a spotlight; two spotlights light nothing.

Depth ranking, low to high: plain box → box with `--line-strong` → box with `--ink` border → box with `--ink` border + offset shadow.

---

## §4 Layout patterns

New recipes drawn from the wireframe. They are specified and available; adopting them into the app is a separate task.

| Class | Recipe |
|---|---|
| `.shell` | `display: grid; grid-template-columns: 1fr var(--rail-width); gap: var(--sp-4); align-items: start`. Below `1024px` it collapses to one column and the rail moves **below** the main column. |
| `.rail` | `display: flex; flex-direction: column; gap: var(--sp-4); position: sticky; top: var(--sp-4)`. Holds telemetry panels. Never holds a primary action. |
| `.topbar` | `display: flex; justify-content: space-between; align-items: center; padding: var(--sp-4) 0; border-bottom: var(--bw-hair) solid var(--line)` |
| `.wordmark` | Inter 700, `0.8125rem`, uppercase, `+0.08em`. The `//` is literal type, not a graphic. |
| `.status-chip` | The one pill in the system. `border: var(--bw-hair) solid var(--line-strong); border-radius: var(--r-pill); padding: var(--sp-2) var(--sp-4); font: var(--font-mono) at .75rem`, with a `6px` `--ink` dot before the label. |

### The step rail

| Class | Recipe |
|---|---|
| `.steps` | `display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--sp-2)` |
| `.step` | Box. `padding: var(--sp-3) var(--sp-4); display: flex; gap: var(--sp-3); align-items: flex-start` |
| `.step[data-state="todo"]` | `border-color: var(--line); background: var(--surface)`; numeral is an outlined circle, `--ink-faint` |
| `.step[data-state="active"]` | `border: var(--bw-bold) solid var(--ink); background: var(--fill)`; numeral inverts |
| `.step[data-state="done"]` | `border-color: var(--line-strong)`; numeral is an outlined circle in `--ink` |
| `.step-num` | `18px` square, `--r-pill`, Syne Mono `0.6875rem`, centred. Inverted when active. |
| `.step-title` | Inter 600, `0.8125rem`, `--ink` |
| `.step-sub` | Inter 400, `0.75rem`, `--ink-muted` |

State must not rest on border colour alone — the numeral treatment changes too, and the active step carries `aria-current="step"`.

### Telemetry panels

| Class | Recipe |
|---|---|
| `.panel` | Box, `padding: var(--sp-4)`. The **live** panel takes move 3 (`--bw-bold` `--ink` + `--shadow-hard`); the rest stay plain. |
| `.panel-eyebrow` | `.eyebrow` type, `--ink-muted`, `margin-bottom: var(--sp-3)` |
| `.panel-title` | Inter 600, `1.0625rem`, `--ink` |
| `.tabs` | `display: flex; gap: var(--sp-2)` |
| `.tab` | Box, `padding: var(--sp-2) var(--sp-3)`, Syne Mono `0.6875rem`, uppercase `+0.08em`. Label reads `1 · CERTIFY REP` — the `·` is a literal separator. |
| `.tab[aria-selected="true"]` | Inverted (move 2). |
| `.state-box` | Box with `background: var(--fill); border-color: var(--line-strong); border-radius: var(--r-sm); padding: var(--sp-3)`, Syne Mono, uppercase for human-readable states (`NO CALL YET`), lowercase for identifiers (`no_component_yet`). Full width of its panel. |
| `.kv` | `display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; align-items: baseline` |
| `.kv + .kv` | `border-top: var(--bw-hair) dotted var(--line)` — dotted rules separate readout rows and appear **nowhere else**. |
| `.kv-label` | Inter 400, `0.75rem`, `--ink-muted` |
| `.kv-value` | Syne Mono, `0.75rem`, `--ink`, `text-align: right`, `tabular-nums`. Empty values render `–` (en dash), never blank. |
| `.panel-note` | Inter 400, `0.75rem/1.5`, `--ink-muted`, `margin-top: var(--sp-3)` |

### Proof list & flow

| Class | Recipe |
|---|---|
| `.proof-list` | `display: flex; flex-direction: column; gap: var(--sp-1)` |
| `.proof-row` | `border-left: var(--bw-bold) solid var(--line-strong); padding: var(--sp-2) var(--sp-3)`, Syne Mono `0.6875rem`. Arrows in content are literal `→`. |
| `.proof-row[data-state="current"]` | `background: var(--fill); border-left-color: var(--ink)` |
| `.flow` | `display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); border-top: var(--bw-hair) dashed var(--line); padding-top: var(--sp-4)` |
| `.flow-node` | `text-align: center`; name Inter 600 `0.75rem`; role `.micro` `--ink-muted` |
| `.flow-arrow` | `→`, `--ink-faint`, `aria-hidden="true"` |
| `.callout` | `border-left: var(--bw-bold) solid var(--ink); background: var(--fill); padding: var(--sp-3) var(--sp-4)`. Title Inter 600 `0.8125rem`; body `0.75rem` `--ink-muted`. No other border. |
| `.eyebrow` | Utility. Syne Mono, `0.6875rem`, uppercase, `+0.12em`, `--ink-muted`. Sits above a heading, `margin-bottom: var(--sp-2)`. |

---

## §5 Component recipes — the existing app

Interaction, defined once and reused:

- **Rest** → as specified per component
- **Hover** → `border-color: var(--ink)`. Nothing moves, nothing fades.
- **Active/press** → `translate(2px, 2px)` **only on elements carrying `--shadow-hard*`**, with the shadow shortening to match — the element presses into its own shadow. Elements without the offset shadow do not move.
- **Focus-visible** → `outline: var(--bw-bold) solid var(--ink); outline-offset: 2px`. No exceptions.
- **Disabled** → `opacity: 0.4; cursor: not-allowed`, no hover response.
- **Transition** → `--dur-base --ease` on `border-color, background-color, color, box-shadow, translate`. Nothing else animates.

### Shell & chrome

| Class | Recipe |
|---|---|
| `.wrap` | `width: var(--container); margin-inline: auto; padding-block: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-6)` |
| `.app-header` | `.topbar` recipe |
| `.app-brand` | `.wordmark` recipe. Render as `Taste Labs // Ed-01` — the existing string already fits the idiom. |
| `.app-brand-dot` | `6px` square (not a circle), `background: var(--ink)`. While pending it blinks opacity `1 → 0.25` at 1s, step timing — a cursor blink, not a pulse. The **only** looping animation in the system. |
| `.grain` | **Retired.** Remove the rule and the `<div className="grain" />` from `main.tsx`. Paper texture contradicts a spec sheet. |
| `.intro-sec` / `.slides-sec` / `.next-sec` / `.taste` | `display: flex; flex-direction: column; gap: var(--sp-4)` |
| `.display` | h1 per §2 scale |
| `.dim` | `color: var(--ink-faint)`. Meta only. |
| `.objective` | Inter `0.9375rem/1.55`, `--ink-muted`, `max-width: var(--measure)` |
| `.timing-note` | `.micro`, `--ink-faint` |

### The stage

| Class | Recipe |
|---|---|
| `.stage` | `aspect-ratio: 16/9; background: var(--fill); border: var(--bw-hair) solid var(--line-strong); border-radius: var(--r-none); overflow: hidden; position: relative`. Flat — the stage is a plate on the page, not a floating card. No offset shadow. |
| `.stage img, .stage video` | `width: 100%; height: 100%; object-fit: cover; display: block` |
| `.caption` | Solid plate, **no blur**. `position: absolute; inset-inline: 0; bottom: 0; background: var(--ink-fill); color: var(--on-ink); padding: var(--sp-3) var(--sp-4)`. Full-bleed inversion across the stage bottom — legible over any image without translucency. |
| `.caption .slide-title` | Inter 600, `0.9375rem`, `--on-ink`, `margin: 0 0 var(--sp-1)` |
| `.caption .narration` | Inter 400, `0.8125rem/1.5`, `color: color-mix(in srgb, var(--on-ink) 78%, transparent)`, `max-width: var(--measure)`, `margin: 0` |
| `.placeholder-tag` | Top-right, `position: absolute; top: var(--sp-2); right: var(--sp-2)`. `.eyebrow` type, `--ink-fill` / `--on-ink`, `padding: var(--sp-1) var(--sp-2)`. No rotation. |

### Controls

| Class | Recipe |
|---|---|
| `.controls` | `display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap` |
| `.btn` | Inter 600, `0.875rem`; `padding: var(--sp-2) var(--sp-4); background: var(--surface); color: var(--ink); border: var(--bw-hair) solid var(--line-strong); border-radius: var(--r-sm)`. Hover: `border-color: var(--ink)`. Flat — no shadow. |
| `.btn-primary` | Inverted, plus the offset: `background: var(--ink-fill); color: var(--on-ink); border: var(--bw-bold) solid var(--ink); box-shadow: var(--shadow-hard-sm)`. Press: `translate(2px,2px)` and shadow → `1px 1px 0`. The one button that moves. |
| `.counter` | Syne Mono, `0.75rem`, `tabular-nums`, `--ink-muted` |
| `.track` | `height: 6px; background: var(--surface); border: var(--bw-hair) solid var(--line-strong); border-radius: var(--r-none); position: relative; cursor: pointer` |
| `.track .fill` | `position: absolute; inset: 0; background: var(--ink)` |
| `.track .ticks` | `position: absolute; inset: 0; pointer-events: none` |
| `.track .tick` | `width: 1px; background: var(--line-strong)` |
| `.track:hover` | `border-color: var(--ink)`. Height never changes. |
| `.composer` | Box, `padding: var(--sp-6)`, `display: flex; flex-direction: column; gap: var(--sp-4)`. The active work card: `--bw-bold` `--ink` border + `--shadow-hard`. |
| `.composer-row` | `display: flex; gap: var(--sp-3); flex-wrap: wrap`; input `flex: 1 1 280px` |
| `.composer input[type="text"]` | Inter `0.9375rem`; `background: var(--fill); border: var(--bw-bold) solid var(--ink); border-radius: var(--r-sm); padding: var(--sp-3) var(--sp-4); color: var(--ink)`. The heavy border marks the one field that matters. |
| `…::placeholder` | `color: var(--ink-faint)` |
| `…:focus` | Standard focus ring; no border or background change |

### Choices, chips, sources

| Class | Recipe |
|---|---|
| `.choices` | `display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--sp-3)` |
| `.choice` | Box, `padding: var(--sp-4); text-align: left; display: flex; flex-direction: column; gap: var(--sp-3); border-color: var(--line-strong)`. Hover: `border: var(--bw-bold) solid var(--ink)` and `background: var(--fill)`. Compensate the border growth with `padding: calc(var(--sp-4) - 1px)` on hover so nothing reflows. |
| `.choice .band` | `display: flex; justify-content: space-between; align-items: center` |
| `.choice .label` | `.eyebrow`, `--ink-faint` |
| `.choice .direction-tag` | `.eyebrow`, inverted, `padding: var(--sp-1) var(--sp-2)`. Square. |
| `.choice .direction` | Inter 400, `0.9375rem/1.5`, `--ink` |
| `.taste-chip` | `.btn` at `0.75rem`, `padding: var(--sp-2) var(--sp-3)`, square. Selected → inverted. Row is `flex-wrap` with `gap: var(--sp-2)`. |
| `.sources ol` | `list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2)` |
| `.sources li` | `padding-left: var(--sp-3); border-left: var(--bw-hair) solid var(--line-strong)` |
| `.sources a` | `color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px`. Hover: `text-decoration-thickness: 2px`. |

### States

| Class | Recipe |
|---|---|
| `.receipt` | `.state-box` recipe. The run-id / pipeline-stage readout — pure machine voice. Remove the ad-hoc `style={{ margin: 0 }}` in `LessonApp.tsx`; fix it in the class. |
| `.block + .block` | `margin-top: var(--sp-2)` |
| `.missing` | `border: var(--bw-hair) dashed var(--line-strong); background: var(--surface); padding: var(--sp-6); color: var(--ink-muted); text-align: center`. Dashed means "nothing here" and is never decorative. |
| `.missing strong` | Inter 600, `--ink` |
| `.snap` | `opacity: 0 → 1` over `--dur-base`. **Opacity only — no movement.** Disabled under reduced motion. |

### Agent copilot

`CodexAgentBubble.tsx` is the only BEM-named component (`agent-panel__*`). Leave the names; do not propagate the pattern.

| Class | Recipe |
|---|---|
| `.agent-bubble` | Fixed. `bottom: var(--sp-6); right: var(--sp-6); border-radius: var(--r-none); padding: var(--sp-2) var(--sp-4)`; inverted + `--shadow-hard-sm`. Press: `translate(2px,2px)`. |
| `.agent-bubble--open` | Reverts to `.btn` (surface + `--ink` border), keeps the shadow. |
| `.agent-bubble__dot` | `6px` **square**, `background: var(--on-ink)`. Currently hardcoded `#22c55e` — a rule 1 violation; there is no green in this system. |
| `.agent-bubble__label` | `.meta` |
| `.agent-bubble__badge` | `.micro`, `opacity: 0.6` |
| `.agent-panel` | `bottom: calc(var(--sp-6) + var(--sp-8)); right: var(--sp-6); width: min(420px, calc(100vw - var(--sp-4) * 2)); max-height: min(580px, 80vh); background: var(--surface); border: var(--bw-bold) solid var(--ink); box-shadow: var(--shadow-hard); display: flex; flex-direction: column; overflow: hidden` |
| `.agent-panel__header` | `padding: var(--sp-3) var(--sp-4); border-bottom: var(--bw-hair) solid var(--line); background: var(--fill); display: flex; justify-content: space-between; align-items: center` |
| `.agent-panel__title-group` | `display: flex; align-items: center; gap: var(--sp-2)` |
| `.agent-panel__title` | `.eyebrow` — a label, not an h2 in the scale, despite the tag |
| `.agent-panel__close` | Transparent, `border: 0`, `--ink-muted`. Hover: `--ink`. Focus ring required. |
| `.agent-panel__messages` | `flex: 1; overflow-y: auto; padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-3)` |
| `.agent-panel__bubble` | `max-width: 88%; padding: var(--sp-3); border: var(--bw-hair) solid var(--line-strong)`. Square. |
| `.agent-panel__bubble--agent` | `background: var(--surface); align-self: flex-start` |
| `.agent-panel__bubble--user` | Inverted, `align-self: flex-end`, `border-color: var(--ink)` |
| `.agent-panel__bubble-meta` | `.micro`, `--ink-faint`. Inside `--bubble--user`: `color: color-mix(in srgb, var(--on-ink) 65%, transparent)` — `--ink-faint` is invisible on black. |
| `.agent-panel__bubble-text` | Inter `0.875rem/1.5`, `margin: 0`. Chat is prose. |
| `.agent-panel__chips` | `display: flex; gap: var(--sp-2); overflow-x: auto; padding: var(--sp-2) var(--sp-4); background: var(--fill)`. Must not create a page-level scrollbar. |
| `.agent-panel__chip` | `.taste-chip` recipe |
| `.agent-panel__form` | `display: flex; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-top: var(--bw-hair) solid var(--line)` |
| `.agent-panel__input` | `.composer input` recipe at `0.875rem`, `flex: 1` |
| `.agent-panel__submit` | `btn btn-primary` + `padding-inline: var(--sp-3)` only |

Typing indicator reuses `.dim`. No shimmer, no animated ellipsis.

---

## §6 Rules

1. **No colour.** No hex outside the `:root` block, and every value in it is a neutral. No accent, no semantic hues, no gradients anywhere.
2. **No raw px in component CSS.** Tokens only.
3. **Square by default.** `--r-sm` for fields and buttons; `--r-pill` only for the status chip and step numerals.
4. **One shadow, and it has no blur.** At most one `--shadow-hard` per column. `rgba` shadows and `filter: blur()` do not exist here.
5. **`--line` never carries meaning.** Interactive boundaries and state changes use `--line-strong` or `--ink` (1.45:1 vs 3.40:1).
6. **Never set `font-weight` on Syne Mono.** One weight ships; emphasis is case, tracking, inversion.
7. **The voices don't mix.** Human-authored text is Inter; system-emitted text is Syne Mono. Not by size — by author.
8. **Max two inversions visible at once.**
9. **State is never colour-only or border-only.** It changes at least two of: fill, rule weight, numeral/icon treatment, ARIA.
10. **Only elements with `--shadow-hard*` move,** and only on press, into their own shadow.
11. **Every interactive element has a `:focus-visible` ring** — 2px `--ink`, 2px offset.
12. **One looping animation exists** (`.app-brand-dot` while pending). No spinners, no skeletons — progress is text in `.receipt` and `.track`.
13. **Dotted rules mean readout rows** (`.kv`); **dashed rules mean absent** (`.missing`, `.flow` top edge). Neither is decorative.
14. **All transform motion is disabled** under `prefers-reduced-motion: reduce`.

---

## §7 Migration from the current tree

| Current | Action |
|---|---|
| `src/styles/riso.css` "MINIMAL MONOCHROME" `:root` (zinc palette, `--radius-sm: 4px`, soft shadows) | Replace with §1. The zinc greys are cool; this system is warm. |
| Dark-mode blocks (~30 duplicated lines + a malformed comma-selector with a nested media query) | **Delete outright.** Light only — no `prefers-color-scheme` in this system. |
| "Compatibility Fallbacks" aliases: `--paper`, `--body`, `--ink-1`, `--ink-2`, `--knockout`, `--on-ink` | Delete. Note `--on-ink` is *reused* in §1 with a new meaning (white text on a black fill) — redefine it, don't alias it. |
| Soft shadows `0 4px 20px -2px rgba(0,0,0,.04)` etc. | → `--shadow-hard` / none. Rule 4. |
| Radii `2/4/6/9999px` | → `--r-none` / `--r-sm` / `--r-pill`. Most elements become square. |
| ~14 `font-variation-settings: "wght" …` | Delete. Rule 6. |
| `.misreg` — inert, applied at 7 sites | Delete the rule; strip the class from `LessonPlayer.tsx` (×3), `NextChoices.tsx` (×3), `TasteFeedback.tsx` (×1), `WidthFollowTitle.tsx` (×1). |
| `WidthFollowTitle.tsx` + `.width-follow*` | **Retire.** Replace with a plain `<h1 className="display">`; its only consumer is `PromptComposer.tsx:21`. Pointer-reactive type contradicts rule 12. |
| `.grain` | Retire the rule and the div in `main.tsx`. |
| `.caption` translucency / `backdrop-filter` | → solid inverted plate. Rule 4. |
| `.choice:hover` black/white inversion of the whole card | → `--fill` background + `--bw-bold` `--ink` border. Inversion is reserved for tags and primaries. |
| `.agent-bubble__dot { background: #22c55e }` | → `var(--on-ink)`. No colour exists. |
| `--surface-raised`, `--canvas`, `--text-main`, `--border`, `--font-mono` (old) | Remap per §1; `--surface-raised` and `--canvas` collapse into `--surface`. |
| Raw px spacing (8/10/12/14/16/18/20/24/32/36/48) | → `--sp-1…--sp-9`. Round to the nearest step. |
| `--ease-snappy` / `--ease-smooth`, three durations | → `--ease`, `--dur-fast`, `--dur-base`. |
| `.receipt` inline `style={{ margin: 0 }}` in `LessonApp.tsx` | Remove; fix in the class. |
| `page/riso.css`, `page/template.html` | Leave as the fixture harness. It shares class names and **will now look different from the app** — expected; do not sync it. |

---

## §8 Slide-image art direction

Generated slides are most of the screen, so they are part of the system. Paste verbatim into every fal prompt, after the per-slide brief. Replaces the placeholder in `codex/skills/slide-image-generation/references/art-direction.md`.

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

Why each constraint:

- **Monochrome, enforced twice** — the page has no colour at all. A single coloured slide would become the loudest element on screen by a wide margin.
- **Empty bottom sixth** — `.caption` is a solid inverted bar across the stage bottom. Unlike a translucent plate it will fully occlude whatever is under it.
- **No text** — models render lettering badly, and every label the page needs already exists as real, selectable, accessible DOM.
- **No frames or shadows** — `.stage` supplies the border. Baked-in framing double-frames the image.
- **Instrument-drawn, not sketched** — a loose hand-drawn line reads as "rough draft"; this system is a finished document that happens to be austere.

---

## §9 Verification

```bash
npm run typecheck && npm run build && npm run test:timing

# every class used in components is specified in §4/§5
grep -rhoE 'className="[^"]*"' src/*.tsx src/components/*.tsx \
  | sed 's/className="//; s/"$//' | tr ' ' '\n' | sort -u

# dead vocabulary gone (expect no hits)
grep -rn "font-variation-settings\|misreg\|--paper\|--ink-1\|--knockout\|Space Grotesk\|Space Mono\|width-follow\|#22c55e\|backdrop-filter\|prefers-color-scheme" src/ index.html

# no colour, no blurred shadows, no raw hex outside :root (rules 1 & 4)
grep -n "#[0-9A-Fa-f]\{3,6\}\|rgba(\|blur(" src/styles/riso.css
```

Check in the browser via **http://localhost:3000/demo** — it replays `codex/examples/fixture-run/` with **no fal or VEED API spend**. Do not exercise `/`; it costs credits.

By eye:
- The stage holds 16:9 at 360px and 1440px.
- Keyboard tab-through shows a visible 2px ring on every control.
- At most one `--shadow-hard` per column, and at most two inversions on screen.
- Every state readable in greyscale *and* distinguishable without relying on border colour alone (rule 9) — the system is already greyscale, so this reduces to: does each state change at least two properties?
- `prefers-reduced-motion: reduce` stops `.snap` and the brand-dot blink.
- The copilot panel opens, scrolls, and does not overlap the stage at narrow widths.
- No horizontal page scrollbar from `.agent-panel__chips` or `.steps`.
