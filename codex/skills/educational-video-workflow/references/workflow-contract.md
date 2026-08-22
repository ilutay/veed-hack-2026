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

## Latency Budget

Measured 2026-08-22 on a six-slide lesson, `WORKFLOW_MODE=live`, via
`scripts/run-pipeline.sh`:

| Stage | Before | After | What changed |
| --- | --- | --- | --- |
| `topic_research` | 7.2s | 1.6s | Three independent Tavily searches now go out together instead of back to back. |
| `content_generation` | 29.8s | 5.8s | Warm pools, `0.25s` poll interval, thread pool sized to the job count. |
| video assembly | 3.8s | 1.8s | x264 `veryfast` instead of `medium`. |
| **total (tool stages)** | **40.8s** | **9.4s** | |

The four things that actually cost time, in order:

1. **fal cold starts.** fal scales pools to zero, and a cold pool dwarfs
   inference: the same narration took 15.2s cold and 4.0s warm on
   `minimax/speech-2.6-turbo`, while `z-image/turbo` reports ~0.5s of GPU time
   either way. Model choice is close to irrelevant next to this — warm, the
   candidates measured 1.5s (`kokoro`), 3.2s (`elevenlabs/turbo-v2.5`) and
   4.1s (`minimax/speech-2.6-turbo`) on the same text. Start
   `codex/tools/warm_fal_endpoints.py` in the background at t=0, underneath
   topic research and script authoring, which need no fal access.
2. **Serialized independent calls.** The Tavily passes and the two
   content-generation branches share no inputs. See the section above.
3. **Poll granularity.** The old 2s queue poll added up to 2s per asset to
   jobs that finish in under a second.
4. **Thread pool starvation.** Six slides plus voiceover plus intro audio is
   eight jobs; the old default of seven workers left the intro audio
   unsubmitted for 5s. The pool is a network wait, not CPU work — size it to
   the job count.

### Fitting 30 seconds

The tool stages leave roughly 20s of headroom, and two things spend it:

- **The script stage must be a single LLM call**, not an agent loop. It sits
  on the critical path between research and generation, and nothing else can
  proceed without `lesson-script.json`.
- **`talking_head_intro` does not fit.** A VEED Fabric render takes 1–2
  minutes on its own — several times the entire budget. The lesson-script
  contract already makes `intro` optional and the stage is skipped when it is
  absent, which is the right default for the 15-second format. Keep it only
  for runs with no wall-clock target, or deliver it asynchronously: publish
  the page from the slide track and swap the intro in when it lands.
