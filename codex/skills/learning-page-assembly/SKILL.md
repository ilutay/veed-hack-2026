---
name: learning-page-assembly
description: Assemble lesson scripts, generated media, and timings into a validated run artifact and optional static lesson harness. Use for the educational-video workflow, not Pioneer curriculum decisions or UI component selection.
---

# Learning Page Assembly

Use this skill to assemble validated educational-video artifacts under one run
root. Pioneer Gym's learner-facing product is the Next application; its
`/lesson` route currently plays one checked-in MP4 with the native browser
player. Assembly does not select curriculum or emit Pioneer Gym UI commands.

## Behavior

- Read `lesson-script.json`, `asset-manifest.json`, and media outputs.
- Copy or reference generated assets under the run root
  (`artifacts/educational-video/{run_id}/`).
- Optionally still emit a static `page/`-style harness for inspection.
- Validate output paths and emit `webpage-build.json`.

## Output

- Run-root assets a local player or publication step can consume
  (`asset-manifest.json`, media)
- `webpage-build.json`
- Optional static `index.html` under `03-webpage/` — an inspection harness, not
  the Pioneer Gym entrypoint

Read `references/page-contract.md` before changing the webpage artifact shape.
Keep `page/` while the static inspection harness remains part of the workflow.
