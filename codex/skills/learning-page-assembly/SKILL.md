---
name: learning-page-assembly
description: Assemble lesson scripts, generated media, and timings so the Tambo LessonPlayer can mount them. The Next.js app is the product UI; this skill copies assets into the run dir and may still emit a static harness.
---

# Learning Page Assembly

The learner-facing entrypoint is the Next.js app (`src/app/page.tsx`), which
mounts `LessonPlayer` against a `run_id`. Use this skill to copy validated
workflow artifacts into the run directory the player reads. Do not treat a
generated `index.html` as the product UI.

## Behavior

- Read `lesson-script.json`, `asset-manifest.json`, and media outputs.
- Copy or reference generated assets under the run root
  (`artifacts/educational-video/{run_id}/`). The app serves them from
  `/api/run/{run_id}/file/...`.
- Optionally still emit a static `page/`-style harness for inspection.
- Validate output paths and emit `webpage-build.json`.

## Output

- Run-root assets the Next player can poll (`asset-manifest.json`, media)
- `webpage-build.json`
- Optional static `index.html` under `03-webpage/` — not the product entrypoint

Read `references/page-contract.md` before changing the webpage artifact shape.
Keep `page/` until `LessonPlayer` is proven.
