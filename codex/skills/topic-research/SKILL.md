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

## Onboarding

Profile-stage tool, not a lesson run. `codex/tools/onboarding_research.py` researches stated interests, emits a multiple-choice quiz, then scores answers and recommends topics.

```bash
python3 codex/tools/onboarding_research.py \
  --stage quiz \
  --slug ada \
  --output-dir artifacts/profiles/ada \
  --interests "the dot-com bubble" "compound interest" \
  --mode dry-run

python3 codex/tools/onboarding_research.py \
  --stage recommend \
  --slug ada \
  --output-dir artifacts/profiles/ada \
  --answers-json '{"q-01":"b","q-02":"c","q-03":"b","q-04":"a","q-05":"c"}' \
  --mode dry-run
```

Output is `onboarding-pack.json` plus `onboarding/status.json` and redacted provider JSON under `onboarding/provider/`. The UI reads the pack via Node; the browser must never see `correct_id`.

Read `references/onboarding-contract.md` before changing CLI flags, passes, scoring thresholds, or artifact paths. Keep `topic_research.py` as the lesson-stage brief tool.
