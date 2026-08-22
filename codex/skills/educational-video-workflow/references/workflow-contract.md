# Workflow Contract

The workflow is split into stages that communicate through files rather than hidden conversation state.

## Canonical Artifacts

- `research-brief.json`: grounded facts, sources, pedagogy, and next-topic directions from `topic_research`.
- `lesson-script.json`: topic, objective, intro script, slide narration, visual briefs, and sources. Written from the brief; this stage does not research.
- `asset-manifest.json`: generated media paths and provider metadata.
- `webpage-build.json`: final page entrypoint, copied assets, and validation status. There is no separate QA stage or `qa-report.md` — `webpage-build.json.checks` and its `notes` array carry validation status and gaps inline, produced by whichever agent runs `assemble_webpage`.

## Run Modes

- `dry-run`: create payloads, prompts, placeholder metadata, and deterministic file paths without external API calls.
- `test`: call sandbox/test MCP or API endpoints only.
- `live`: call production providers only after credentials and user intent are explicit.

## Stage Rule

Each stage should be rerunnable from its declared inputs. If a provider returns an id, persist it in that stage's metadata before polling or transforming the result.

## Content Generation Concurrency

The `content_generation` step has two independent branches with no data
dependency between them, so they must be started together, not chained.
Sequencing them back-to-back (fal script fully finishes, then start the VEED
MCP calls) is a workflow bug, not just a slower path: the VEED render alone
typically takes 1-2 minutes, so serializing it after slide/voiceover
generation can roughly double or triple the wall-clock time of the whole
`content_generation` step for no reason — neither branch reads the other's
output.

**Use a subagent for the branch that would otherwise block your own turn.**
A plain background shell process (`run_in_background`) is enough for two
independent *shell commands*, but the VEED branch isn't a shell command — it
is a sequence of MCP tool calls (`confirm_fabric_video` →
`create_fabric_video` → poll `get_generation_status`) that the orchestrating
agent has to drive turn-by-turn. If that same agent also runs
`fal_media_agent.py` in the foreground first, the VEED sequence cannot start
until the fal script exits, no matter how the fal script itself is invoked.
Concretely:

- Launch a subagent (Agent tool; a `fork` is enough since it inherits run
  context) to drive `codex/tools/fal_media_agent.py` end to end — submit,
  poll, download, write `asset-manifest.json` — and report back on exit. This
  frees the orchestrating agent's own turn immediately.
- In the same response that launches that subagent, the orchestrating agent
  itself starts the `veed-talking-head` skill's MCP tool sequence. It does
  not wait for the fal subagent first.
- Only rendezvous — reading both results and moving to `assemble_webpage` —
  once the fal subagent has reported back **and** `get_generation_status`
  has returned a terminal status.

This is the single highest-leverage optimization in the whole pipeline: it
turns the stage's wall-clock time from *(fal time) + (VEED time)* into
*max(fal time, VEED time)*, and VEED is usually the longer of the two.
