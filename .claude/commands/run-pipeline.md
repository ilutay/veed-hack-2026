---
description: Run the full educational-video pipeline end-to-end (research -> script -> content generation -> assembly)
---

Act as the orchestrator described in `codex/subagents/orchestrator-agent.md`. Run the complete
`codex/workflows/educational-video.yaml` pipeline for the topic below, without re-deriving the
workflow from scratch — the shape of the run is fixed by that yaml and by
`codex/skills/educational-video-workflow/SKILL.md`.

**Arguments** (parse from `$ARGUMENTS`; ask only if `topic` is missing and can't be inferred):
- `topic` (required): the learning subject.
- `learner_profile` (optional): audience/level/tone/target_duration_seconds. Default to something
  reasonable (e.g. curious general audience, intermediate level, ~15s target duration) if not given.
- `run_mode` (optional): `dry-run` (default), `test`, or `live`. Never promote to `live` on your own
  initiative — only use it if the user explicitly asked for a live run in `$ARGUMENTS`.
- `output_dir` (optional): default to `artifacts/educational-video/<slug-of-topic>`.

**Before starting:**
1. Read `AGENTS.md` for the credential/env rules — never `cat`/read `.env.local`, always go through
   `scripts/with-env.sh`, and if `run_mode` is not `dry-run`, run `scripts/check-env.sh` first.
2. Read `codex/skills/educational-video-workflow/SKILL.md` and
   `codex/skills/educational-video-workflow/references/workflow-contract.md` for the concurrency
   requirements and latency-budget notes — they are non-negotiable, not optional optimizations.

**Execution — follow the SKILL.md steps in order:**
1. If `run_mode` is not `dry-run`, kick off `codex/tools/warm_fal_endpoints.py` in the background and
   do not wait on it.
2. Run the `topic_research` stage (`codex/subagents/topic-research-agent.md` +
   `codex/skills/topic-research`) to produce `research-brief.json`.
3. Run the `research_script` stage (`codex/subagents/research-script-agent.md` +
   `codex/skills/topic-research-script`) to produce `lesson-script.json`. Do not redo web research.
4. The instant `lesson-script.json` exists, launch content generation as parallel subagents in the
   SAME turn — never run one to completion before starting the next:
   - `talking_head_intro` (`codex/subagents/talking-head-agent.md` + `codex/skills/veed-talking-head`,
     via the VEED Fabric MCP tools) — skip this branch entirely when the run has a tight wall-clock
     target (it's a 1-2 min render and the lesson script contract makes `intro` optional).
   - `slide_images` (`codex/subagents/slide-image-agent.md` + `codex/skills/slide-image-generation`)
   - `voiceover_video` (`codex/subagents/voiceover-agent.md` + `codex/skills/voiceover-video-generation`)
   Prefer using `codex/tools/fal_media_agent.py` for the fal-backed assets (slides + voiceover +
   intro audio) as a single subagent invocation, per the SKILL.md guidance.
5. Once every branch reports back, run `assemble_webpage`
   (`codex/subagents/page-assembly-agent.md` + `codex/skills/learning-page-assembly`) to produce
   `index.html` under the run's output directory. Validate each contract inline as it's consumed —
   there is no separate QA pass.

**On failure:** stop immediately and report the failing artifact path plus the validation error —
do not paper over a contract mismatch or silently fall back to a different provider/mode.

**Topic and options:** $ARGUMENTS
