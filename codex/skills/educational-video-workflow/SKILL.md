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
5. The instant `lesson-script.json` exists, run content generation via
   `codex/tools/fal_media_agent.py` (slide images, voiceover, and — when
   `intro` is present — the intro-audio clip, the presenter avatar image, and
   the `veed/fabric-1.0` talking-head video). It's a single script
   invocation covering every fal-backed asset for this stage, already
   parallelized internally across a thread pool; give it the lesson-script
   path and run-id and let it report back when the process exits. There is
   no separate MCP tool sequence to drive anymore — see
   `references/workflow-contract.md`.
   When the run has a wall-clock target, omit `intro` from the lesson script
   (the contract makes it optional and the stage is skipped when absent):
   the talking-head video's avatar-image and intro-audio dependencies still
   make it the slowest asset in this stage by far.
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
