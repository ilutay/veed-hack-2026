---
name: topic-research
description: Ground a lesson topic with Tavily search and extract, then emit research-brief.json for the research_script stage. Does not write narration.
---

# Topic Research

Use this skill to run the `topic_research` stage. The output is grounded knowledge, not a video script. Downstream `research_script` decides what the video says.

## Inputs

- **topic** (required)
- **taste-profile.json** (optional; missing ≡ all-zero axes)
- **audience** (optional; default `general learners`)
- **output_dir** — workflow run root
- **run_id**
- **WORKFLOW_MODE** — `dry-run` (default), `test`, or `live`

## Command

Dry-run (no network, no credentials):

```bash
scripts/with-env.sh python3 codex/tools/topic_research.py \
  --topic "The dot-com bubble" \
  --output-dir artifacts/educational-video/{run_id} \
  --run-id {run_id}
```

Live (only when the user has set `WORKFLOW_MODE=live` in this conversation and preflight passes):

```bash
WORKFLOW_MODE=live scripts/with-env.sh python3 codex/tools/topic_research.py \
  --topic "The dot-com bubble" \
  --output-dir artifacts/educational-video/{run_id} \
  --run-id {run_id} \
  --mode live
```

Never read `.env.local`. Never echo `TAVILY_API_KEY`. The live path calls `scripts/check-env.sh tavily` before the first request.

## Output

- `00-topic-research/research-brief.json` matching `codex/contracts/research-brief.schema.json`
- Redacted provider request/response JSON under `00-topic-research/provider/`

Read `references/tavily-contract.md` before changing auth, passes, payload fields, or artifact paths.
