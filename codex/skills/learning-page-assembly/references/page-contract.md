# Page Contract

The first webpage implementation should optimize for inspection and iteration.

## Required Experience

- intro video section
- slide sequence with one image per slide
- synchronized or manually navigable voiceover playback
- visible slide title and key points
- source list when sources are present

## Run Path

The page resolves every asset relative to its run root, so the assembled
`index.html` must declare that root explicitly:

```html
<body data-run="../">   <!-- 03-webpage/index.html -> the run root -->
```

Asset paths in `asset-manifest.json` are relative to the run root
(`02-content-generation/...`), and `asset-manifest.json` and `lesson-script.json`
both sit at the run root — not in a stage directory. `page/template.html` is the
development harness for the same renderer and defaults to a fixture under
`codex/examples/`; do not copy that default into a generated page.

## Validation

- Every referenced asset path exists.
- The page renders locally.
- Long text does not overflow slide controls or captions.
- Placeholder assets are visibly flagged in QA output, not hidden from the user.
