---
name: educational-video-workflow
description: Orchestrate a multi-agent workflow that turns a learning topic into an educational video webpage with research, Veed intro, slide images, voiceover, and assembly stages.
---

# Educational Video Workflow

Use this skill when the user wants to generate or iterate on the full educational video pipeline.

## Workflow

1. Read the work order or collect the topic, learner profile, run mode, and output directory.
2. Use the research-script stage to produce `lesson-script.json`.
3. Run the content generation branches concurrently, not sequentially — each
   stage's wall-clock time (slide images, voiceover, and the ~1-2 minute VEED
   Fabric MCP render) is comparable, and running them one after another
   roughly triples total run time for no benefit, since none of the three
   depends on another's output:
   - `codex/tools/fal_media_agent.py` (slide images, voiceover, and the fal
     intro-audio clip) — launch as a background process; it is a single
     script invocation covering all three fal-backed assets.
   - the talking-head intro video through the `veed-talking-head` skill — an
     agent-driven MCP tool sequence, kicked off in the same turn as the fal
     script rather than after it returns. See `references/workflow-contract.md`
     for the concurrency requirement.
   Only block on both finishing once you reach step 4.
4. Assemble the final webpage from validated contracts and media assets.
5. Run integration QA and report skipped live calls, placeholders, and contract failures.

## Contracts

Use these repository contracts as the source of truth:

- `codex/contracts/lesson-script.schema.json`
- `codex/contracts/asset-manifest.schema.json`
- `codex/contracts/webpage-build.schema.json`

Read `references/workflow-contract.md` when adding a new stage, changing artifact handoffs, or wiring real API/MCP tools.

## Constraints

- Default to dry-run behavior unless credentials, provider names, and run mode are explicit.
- Keep provider-specific payloads and raw responses under the run directory.
- Do not make downstream agents redo topic research; they should consume the lesson script.
- Fail fast on schema mismatches before calling expensive or mutating provider APIs.
