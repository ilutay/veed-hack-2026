---
name: learning-page-assembly
description: Assemble lesson scripts, generated media, and timings into a webpage for the educational video workflow.
---

# Learning Page Assembly

Use this skill to build the final web experience from validated workflow artifacts.

## Behavior

- Read `lesson-script.json`, `asset-manifest.json`, and media outputs.
- Copy or reference generated assets under the webpage output directory.
- Render intro video, slide images, narration controls, slide text, and citations.
- Keep the first build simple and locally previewable.
- Validate output paths and emit `webpage-build.json`.

## Output

- `index.html` or app entrypoint
- `assets/`
- `webpage-build.json`

Read `references/page-contract.md` before changing the webpage artifact shape.
