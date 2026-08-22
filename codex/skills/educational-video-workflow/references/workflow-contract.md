# Workflow Contract

The workflow is split into stages that communicate through files rather than hidden conversation state.

## Canonical Artifacts

- `lesson-script.json`: topic, objective, intro script, slide narration, visual briefs, and sources.
- `asset-manifest.json`: generated media paths and provider metadata.
- `webpage-build.json`: final page entrypoint, copied assets, and validation status.
- `qa-report.md`: human-readable status and gaps.

## Run Modes

- `dry-run`: create payloads, prompts, placeholder metadata, and deterministic file paths without external API calls.
- `test`: call sandbox/test MCP or API endpoints only.
- `live`: call production providers only after credentials and user intent are explicit.

## Stage Rule

Each stage should be rerunnable from its declared inputs. If a provider returns an id, persist it in that stage's metadata before polling or transforming the result.

## Content Generation Concurrency

The `content_generation` step has two independent branches with no data
dependency between them, so they must be started together, not chained:

- `codex/tools/fal_media_agent.py` (slide images + voiceover + fal intro
  audio) — start this as a background process (e.g. `run_in_background` /
  Monitor) as soon as `lesson-script.json` is available.
- the `veed-talking-head` skill's MCP tool sequence (talking-head video) —
  start it in the same turn, immediately after launching the fal script, not
  after the fal script finishes.

Then wait on both before moving to assembly. Sequencing them back-to-back
(fal script fully finishes, then start the VEED MCP calls) is a workflow bug,
not just a slower path: the VEED render alone typically takes 1-2 minutes, so
serializing it after slide/voiceover generation can roughly double or triple
the wall-clock time of the whole `content_generation` step for no reason —
neither branch reads the other's output.
