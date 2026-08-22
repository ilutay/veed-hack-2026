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

All of `content_generation` — slide images, voiceover, and the full
talking-head stage (intro audio, avatar image, and the `veed/fabric-1.0`
video) — now runs through fal from a single `codex/tools/fal_media_agent.py`
invocation. There is no separate MCP tool sequence for the orchestrating
agent to drive turn-by-turn anymore: launch that one script (directly, or as
a subagent if you want the orchestrating agent's own turn free in the
meantime) and let its internal thread pool handle the fan-out.

Inside the script, the avatar image and intro audio jobs are submitted in
parallel with the slide images and voiceover. The `veed/fabric-1.0` video
request is the one real data dependency in this stage — it needs both the
avatar image URL and the intro audio URL, so it is only submitted after
those two jobs complete. That dependency is internal to the script and
requires no orchestration from the calling agent.

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
- **`talking_head_intro` does not fit.** A `veed/fabric-1.0` render plus its
  avatar-image and intro-audio dependencies still takes well over the entire
  budget. The lesson-script contract already makes `intro` optional and the
  stage is skipped when it is absent, which is the right default for the
  15-second format. Keep it only for runs with no wall-clock target, or
  deliver it asynchronously: publish the page from the slide track and swap
  the intro in when it lands.
