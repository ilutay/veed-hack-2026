---
name: educational-video-workflow
description: Orchestrate a multi-agent workflow that turns a learning topic into an educational video webpage with research, Veed intro, slide images, voiceover, and assembly stages.
---

# Educational Video Workflow

Use this skill when the user wants to generate or iterate on the full educational video pipeline.

## Workflow

1. Read the work order or collect the topic, learner profile, run mode, and output directory.
2. Outside `dry-run`, start `codex/tools/warm_fal_endpoints.py` in the
   background *before* step 3 and do not wait on it. fal scales its pools to
   zero and a cold pool costs more than the inference does (15.2s vs 4.0s for
   the same narration); steps 3 and 4 need no fal access, so warming happens
   underneath them for free. See `references/workflow-contract.md` →
   "Latency Budget".
3. Run `topic_research` to produce `research-brief.json`.
4. Use the research-script stage to turn that brief into `lesson-script.json`. Do not do new web research.
5. The instant `lesson-script.json` exists, launch content generation as two
   parallel subagents in the same response — never run one to completion
   before starting the other. Each subagent's wall-clock time (slide images +
   voiceover on one side, the ~1-2 minute VEED Fabric MCP render on the
   other) is comparable; chaining them roughly doubles this stage's total
   time for no benefit, since neither reads the other's output:
   - Subagent A: `codex/tools/fal_media_agent.py` (slide images, voiceover,
     and the fal intro-audio clip) — a single script invocation covering all
     three fal-backed assets, already parallelized internally across a
     thread pool. Give this subagent the lesson-script path and run-id and
     let it report back when the process exits.
   - Subagent B (or the orchestrating agent itself, since it already holds
     the MCP connection): the talking-head intro video through the
     `veed-talking-head` skill — an agent-driven MCP tool sequence
     (`confirm_fabric_video` → `create_fabric_video` → poll
     `get_generation_status`). Start this in the same turn you launch
     Subagent A, not after it returns.
   See `references/workflow-contract.md` for the concurrency requirement and
   why blocking on Subagent A before starting the VEED sequence roughly
   doubles the stage's time.
   Only proceed to step 6 once both report back. When the run has a
   wall-clock target, drop Subagent B: a VEED render takes 1-2 minutes on its
   own, so omit `intro` from the lesson script (the contract makes it
   optional and the stage is skipped when absent).
6. Assemble the final webpage from validated contracts and media assets. This is the last stage — there is no separate QA pass; validate paths and contracts inline as each stage's output is consumed, and surface any gap immediately rather than deferring it to a report.

## Contracts

Use these repository contracts as the source of truth:

- `codex/contracts/research-brief.schema.json`
- `codex/contracts/taste-profile.schema.json`
- `codex/contracts/lesson-script.schema.json`
- `codex/contracts/asset-manifest.schema.json`
- `codex/contracts/webpage-build.schema.json`

Read `references/workflow-contract.md` when adding a new stage, changing artifact handoffs, or wiring real API/MCP tools.

## Constraints

- Default to dry-run behavior unless credentials, provider names, and run mode are explicit.
- Keep provider-specific payloads and raw responses under the run directory.
- Do not make downstream agents redo topic research; they should consume the lesson script.
- Fail fast on schema mismatches before calling expensive or mutating provider APIs.
- **Every generated run is durable.** As soon as a run is minted, append it to
  `artifacts/educational-video/library.json`. Do not delete, overwrite, or
  treat a finished run as disposable. The learner retrieves past lessons at
  any time via `GET /api/runs` and the in-app Lessons list. Point them at
  that list; do not regenerate a lesson they already have.
- **Never remount the on-screen player to deliver a chat reply.** `agent_message`
  updates taste / conversation only (`keep_blocks`). A new topic still writes
  a library entry, but the currently playing video stays on screen until the
  learner pauses or the lesson ends. Only then may `library_selected` or a
  new `topic_submitted` swap `LessonPlayer` to another `run_id`.
