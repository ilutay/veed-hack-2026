---
name: educational-video-workflow
description: Orchestrate a multi-agent workflow that turns a learning topic into an educational video webpage with research, Veed intro, slide images, voiceover, and assembly stages.
---

# Educational Video Workflow

Use this skill when the user wants to generate or iterate on the full educational video pipeline.

## Workflow

1. Read the work order or collect the topic, learner profile, run mode, and output directory.
2. Run `topic_research` to produce `research-brief.json`.
3. Use the research-script stage to turn that brief into `lesson-script.json`. Do not do new web research.
4. Run the content generation branches in parallel when possible:
   - talking-head intro through the Veed stage
   - one image per slide through the slide-image stage
   - voiceover video or timed narration through the voiceover stage
5. Assemble the final webpage from validated contracts and media assets.
6. Run integration QA and report skipped live calls, placeholders, and contract failures.

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
