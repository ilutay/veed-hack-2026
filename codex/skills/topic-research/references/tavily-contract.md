# Tavily Contract

`codex/tools/topic_research.py` is the only client for this stage. Request bodies are the documented POST `/search` and POST `/extract` fields; do not invent parameters.

Verified against https://docs.tavily.com/documentation/api-reference/endpoint/search and `/extract`.

## Auth

- Header: `Authorization: Bearer $TAVILY_API_KEY`
- Base URL: `https://api.tavily.com` (override with `TAVILY_BASE_URL`)
- Endpoints: `POST {base}/search`, `POST {base}/extract`
- Load credentials with `scripts/with-env.sh`. Preflight with `scripts/check-env.sh tavily`. Never read `.env.local`.

## Four passes

`include_usage: true` on every call. Live `research.credits` is the sum of `usage.credits` (fall back to the table if usage is missing).

| Pass           | Query                                                            | Body                                                      | Table credits |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | ------------- |
| `ground_facts` | the topic                                                        | `search_depth: advanced`, `include_raw_content: markdown` | 2             |
| `strategy`     | `how to teach {topic}, misconceptions about {topic}`             | `search_depth: advanced`                                  | 2             |
| `next_topics`  | `adjacent subtopics, prerequisites, and applications of {topic}` | `search_depth: basic`, `max_results: 20`                  | 1             |
| `extract`      | top 5 URLs from pass 1                                           | `POST /extract` with `urls`                               | 1             |

## Modes

| Mode                | Network                                                                                                                                                         | `research.provider` | `research.mode` | `research.credits` |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------- | ------------------ |
| `dry-run` (default) | none. Replay recorded fixtures under `codex/examples/fixture-run/00-topic-research/tavily/` when the topic matches; otherwise emit an honest placeholder brief. | `fixture`           | `dry-run`       | 0                  |
| `test`              | no Tavily sandbox exists; behave like dry-run                                                                                                                   | `fixture`           | `test`          | 0                  |
| `live`              | real Tavily after `check-env.sh tavily`                                                                                                                         | `tavily`            | `live`          | summed usage       |

Never present a dry-run or test brief as live-researched. `style_notes` must say so.

## Mapping into research-brief.json

| Brief field               | Source                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `concept`                 | lead takeaway; consumed as lesson-script `learning_objective`                                              |
| `facts[].source_id`       | a `sources[].id`; consumed as `slides[].source_ids`. A claim with no `source_id` must not reach narration. |
| `next_topics[].direction` | `deeper` \| `wider` \| `applied`                                                                           |
| `sources[]`               | identical item shape to lesson-script `sources[]` (copy through verbatim)                                  |
| `taste_hints`             | `pace` / `depth` / `concreteness` from taste-profile `axes`; missing profile ≡ all zeroes                  |

## Artifact paths

Run root is `--output-dir`.

- `00-topic-research/research-brief.json`
- `00-topic-research/provider/{pass}-request.json`
- `00-topic-research/provider/{pass}-response.json` (redacted: no `Authorization`, query-string tokens stripped from URLs)
