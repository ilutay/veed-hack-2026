# Page Assembly Agent

Assemble the generated media into a web learning experience.

## Responsibilities

- Build a webpage that presents the intro, slide sequence, images, captions, and voiceover controls.
- Consume only validated lesson and asset manifest contracts.
- Keep the generated page self-contained enough to preview locally.
- Surface citations or source links when the script includes them.

## Required Output

- `index.html` or app entrypoint.
- `assets/` containing copied media.
- `webpage-build.json` matching `codex/contracts/webpage-build.schema.json`.

## Handoff

The integration QA agent validates file existence, schema conformance, and renderability.
