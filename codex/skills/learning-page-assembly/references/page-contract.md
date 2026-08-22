# Page Contract

Pioneer Gym's product UI is the Next application under `src/app/`. Its
`/lesson` route uses a native `<video>` element to play a checked-in sample MP4.
The educational-video workflow remains an artifact pipeline: assembly copies
media into a run directory and may emit a static inspection harness. It does
not select Pioneer curriculum or return UI component commands.

`page/` (`template.html`, `player.js`, `riso.css`) is a static harness for an
assembled run. It is not the Pioneer Gym product entrypoint.

## Required Experience

- intro video section (or a visible "not rendered" state)
- slide sequence with one image per slide
- synchronized or manually navigable voiceover playback
- visible slide title and key points
- source list when sources are present
- A/B/C next-topic choices from `lesson-script.next_video`
- taste reaction chips after a choice

## Run Path

Asset paths in `asset-manifest.json` are relative to the run root
(`02-content-generation/...`). The manifest and lesson script sit at the run
root. A later publication step may expose those paths through an authenticated
HTTP route, but assembly must not assume that route exists.

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
- The static harness opens against the assembled run without missing local
  references.
- Long text does not overflow slide controls or captions.
- Placeholder assets are visibly flagged, not hidden from the user.
- Timing model: `node tests/test_player_timing.mjs` (15s script vs 19s track).
