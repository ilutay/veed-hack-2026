# Workflow Contract

The workflow is split into stages that communicate through files rather than hidden conversation state.

## Canonical Artifacts

- `research-brief.json`: grounded facts, sources, pedagogy, and next-topic directions from `topic_research`.
- `lesson-script.json`: topic, objective, intro script, slide narration, visual briefs, and sources. Written from the brief; this stage does not research.
- `asset-manifest.json`: generated media paths and provider metadata.
- `webpage-build.json`: final page entrypoint, copied assets, and validation status.
- `qa-report.md`: human-readable status and gaps.

## Run Modes

- `dry-run`: create payloads, prompts, placeholder metadata, and deterministic file paths without external API calls.
- `test`: call sandbox/test MCP or API endpoints only.
- `live`: call production providers only after credentials and user intent are explicit.

## Stage Rule

Each stage should be rerunnable from its declared inputs. If a provider returns an id, persist it in that stage's metadata before polling or transforming the result.
