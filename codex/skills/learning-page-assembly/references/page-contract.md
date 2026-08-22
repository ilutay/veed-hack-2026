# Page Contract

The product UI is the Vite + React Router app at the repo root (`src/main.tsx`).
Tambo's registry renderer mounts `PromptComposer`, `LessonPlayer`, `NextChoices`,
and `TasteFeedback`. Codex (`POST /api/codex/action`) starts pipeline runs and
returns component blocks. Assembly may still copy assets into the run directory
so the player can resolve them; it is not the learner-facing page.

`page/` (`template.html`, `player.js`, `riso.css`) is the design source and a
static harness. Do not delete it until `LessonPlayer` is proven against a real
run. Visual tokens live in `docs/riso-system.md` and `src/styles/riso.css`.

## Required Experience

- intro video section (or a visible "not rendered" state)
- slide sequence with one image per slide
- synchronized or manually navigable voiceover playback
- visible slide title and key points
- source list when sources are present
- A/B/C next-topic choices from `lesson-script.next_video`
- taste reaction chips after a choice

## Run Path

The player resolves a run through `GET /api/run/{run_id}` and assets
through `/api/run/{run_id}/file/{path}`. Asset paths in `asset-manifest.json`
are relative to the run root (`02-content-generation/...`). Manifest and
lesson-script sit at the run root.

The static harness still supports an assembled `index.html` that declares the
run root explicitly:

```html
<body data-run="../">
  <!-- 03-webpage/index.html -> the run root -->
</body>
```

`page/template.html` defaults to `codex/examples/fixture-run/` for local
development; do not copy that default into a generated page.

## Validation

- Every referenced asset path exists, or the UI flags it (placeholder tag / missing).
- The page renders locally (`npm run dev`).
- Long text does not overflow slide controls or captions.
- Placeholder assets are visibly flagged, not hidden from the user.
- Timing model: `node tests/test_player_timing.mjs` (15s script vs 19s track).
