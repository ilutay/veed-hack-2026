# Onboarding Research Contract

`codex/tools/onboarding_research.py` is the client for the profile-stage quiz and recommendations. It is not a lesson-run stage. Request bodies are the documented POST `/search` and POST `/extract` fields; do not invent parameters.

Auth, base URL, and credential loading match [tavily-contract.md](tavily-contract.md): `Authorization: Bearer $TAVILY_API_KEY`, `scripts/with-env.sh`, preflight `scripts/check-env.sh tavily` before the first live request. Never read `.env.local`. Never echo `TAVILY_API_KEY`.

The HTTP/UI layer reads `onboarding-pack.json` and **must strip `correct_id` (and `rationale` if present) before sending quiz questions to the browser**. This tool always writes the full pack, including `correct_id`, so scoring can run later.

## CLI

```bash
python3 codex/tools/onboarding_research.py \
  --stage quiz \
  --slug ada \
  --output-dir artifacts/profiles/ada \
  --interests "the dot-com bubble" "compound interest" \
  --goal "understand the basics" \
  --mode dry-run

python3 codex/tools/onboarding_research.py \
  --stage recommend \
  --slug ada \
  --output-dir artifacts/profiles/ada \
  --answers-json '{"q-01":"b","q-02":"c","q-03":"b","q-04":"a","q-05":"c"}' \
  --mode dry-run
```

| Flag | Notes |
| --- | --- |
| `--stage` | `quiz` \| `recommend` (required) |
| `--slug` | learner filesystem key (required) |
| `--output-dir` | profile root (required) |
| `--interests` | repeatable strings; quiz stage; 1–5 |
| `--goal` | optional |
| `--answers-json` | object of question id → choice id; recommend stage |
| `--mode` | `dry-run` \| `test` \| `live` (default `WORKFLOW_MODE` or `dry-run`) |
| `--fixture-pack` | default `codex/examples/fixture-run/00-topic-research/onboarding/pack.json` |

Do not set `WORKFLOW_MODE=live` from this tool. Live requires `--mode live` (or an already-exported `WORKFLOW_MODE`) plus a passing tavily preflight.

This tool does not create `learner-profile.json`. If that file already exists it may patch `onboarding` fields (`status`, `interests`, `goal`, `quiz_score`, `level`, `recommended_topics`) and `updated_at`. Identity is owned by the Node server.

## Passes

`include_usage: true` on every live call. Live `research.credits` is the sum of `usage.credits` (fallback 1 per call). Cap live interest searches at 3.

| Pass | When | Query / body | Table credits |
| --- | --- | --- | --- |
| `interests` | quiz, live | one POST `/search` per interest (max 3): `{interest} key facts common misconceptions beginner quiz`. Body: `search_depth: basic`, `include_raw_content: markdown`, `include_usage: true`, `max_results: 8` | 1 |
| `extract` | quiz, live | top 5 unique URLs across those searches. POST `/extract` `{ urls, include_usage: true }` | 1 |
| `level_quiz` | fixture / queries enum only | not a separate live HTTP call; quiz items are mapped from interests + extract | — |
| `recommend` | recommend, live (optional) | one POST `/search`: `{top interest} {level} next lesson topics applications prerequisites`. Body: `search_depth: basic`, `include_usage: true`. On failure, fall back to interest-templated recommendations and note it | 1 |

All search passes use `search_depth: basic`.

## Modes

Same honesty rules as the lesson-stage Tavily contract.

| Mode | Network | `research.provider` | `research.mode` | `research.credits` |
| --- | --- | --- | --- | --- |
| `dry-run` (default) | none. Quiz rewrites the fixture pack (slug, interests, goal, question `topic` cycling). Recommend scores locally and templates 3 topics | `fixture` | `dry-run` | 0 |
| `test` | no Tavily sandbox exists; behave like dry-run | `fixture` | `test` | 0 |
| `live` | real Tavily after `check-env.sh tavily` | `tavily` | `live` | summed usage |

Never present a dry-run or test pack as live-researched. `style_notes` must say so.

## Scoring

`score_answers(pack, answers) -> (correct, total, level)`. Unanswered questions are wrong.

| Ratio | Level |
| --- | --- |
| `< 0.4` | `beginner` |
| `< 0.75` | `intermediate` |
| else | `advanced` |

After quiz, if a profile exists, `onboarding.status` is `"quiz"`. After recommend it is `"complete"`.

## Artifact paths

Profile root is `--output-dir`.

- `onboarding-pack.json` — full OnboardingPack (includes `correct_id`)
- `onboarding/status.json` — `{ "status": "pending" \| "ready" \| "failed", "stage": "quiz" \| "recommend", "error"?: string }`
- `onboarding/provider/{pass}-request.json`
- `onboarding/provider/{pass}-response.json` (redacted: no `Authorization`, query-string tokens stripped from URLs)

Write `status.json` pending at start, ready or failed at end. On exception: failed + message, exit 1.

Provider JSON is not shown to the browser. The Node server may serve the pack with answer keys removed.
