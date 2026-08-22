# AGENTS.md

How agents and humans handle API credentials in this repo. Read this before any
stage that touches an external provider (fal.ai, Veed.io, Pioneer, or Codex).

## TL;DR

```bash
cp .env.example .env.local     # once, then paste real keys in
scripts/check-env.sh           # what is loaded (names + lengths, never values)
scripts/with-env.sh <command>  # run anything with credentials in scope
```

Never open `.env.local`. Never paste a key into a command, a file, or a message.

## Layout

| File | Tracked | Purpose |
| --- | --- | --- |
| `.env.example` | yes | Template: key names, where to get them, which stage needs them. No values. |
| `.env.local` | **no** | Real developer keys. Gitignored. The only place secrets live. |
| `.env` | **no** | Optional shared non-secret defaults (base URLs, `WORKFLOW_MODE`). |
| `scripts/with-env.sh` | yes | Loads env files and execs your command. The sanctioned way to get a key into a process. |
| `scripts/check-env.sh` | yes | Preflight: reports presence and length of each key. Never prints values. |

Precedence, later wins: `.env` → `.env.local` → variables already exported in
your shell. So `FAL_KEY=other scripts/with-env.sh …` overrides the file for one
run, which is how you test a second account without editing anything.

## Running something that needs a key

Always go through the runner. It keeps the secret in the process environment and
out of your shell history, the transcript, and the repo.

```bash
# HTTP call
scripts/with-env.sh bash -c 'curl -sS \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d @payload.json \
  https://queue.fal.run/fal-ai/flux/dev'

# Script in any language — read from os.environ / process.env as normal
scripts/with-env.sh python codex/tools/generate_slides.py
scripts/with-env.sh node codex/tools/assemble.mjs
```

Note the single quotes in the `bash -c` form: `$FAL_KEY` must expand **inside**
the child process, not in your outer shell where it would be logged verbatim.

### Verify auth without spending credits

fal returns 401 for a bad key and 200/404 for a good one on a status lookup:

```bash
scripts/with-env.sh bash -c 'curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Key $FAL_KEY" \
  https://queue.fal.run/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status'
```

## Run modes and credentials

`WORKFLOW_MODE` gates external calls. It matches the modes in
`codex/skills/educational-video-workflow/references/workflow-contract.md`.

| Mode | Credentials | Behaviour |
| --- | --- | --- |
| `dry-run` (default) | none | Emit payloads, prompts, placeholder metadata, deterministic paths. No network. |
| `test` | sandbox keys | Sandbox/test endpoints and MCP test tools only. |
| `live` | real keys | Production providers. Requires explicit user intent, per stage, in the current conversation. |

Rules that follow from this:

- **Default to `dry-run`.** A stage with no mode set does not call anything.
- **Never promote a run to `live` on your own initiative.** A missing key is not
  a problem to solve by switching providers or accounts — stop and ask.
- **Gate on the preflight, not on a try/except.** Call
  `scripts/check-env.sh <provider>` before the first request of a stage; a clean
  early exit beats a half-generated artifact set.

```bash
WORKFLOW_MODE=live scripts/with-env.sh scripts/check-env.sh fal
WORKFLOW_MODE=live scripts/with-env.sh scripts/check-env.sh pioneer codex
```

Veed.io is not in this table — see [MCP servers](#mcp-servers) below. It
authenticates by OAuth through the agent's MCP connection, not an env var, so
`check-env.sh` has nothing to check for it.

## Secret hygiene

Non-negotiable, in rough order of how easy each is to do by accident:

1. **Do not `cat`, `grep`, `head`, or otherwise read `.env.local`.** Its contents
   land in the transcript, which is not a secret store. Use `check-env.sh`.
2. **Do not echo a key** to prove it loaded — `check-env.sh` reports length.
3. **Do not inline a literal key** in a command, script, config, or test fixture,
   even temporarily. There is no temporarily; it is in the history.
4. **Redact before persisting.** The workflow persists provider responses under
   `artifacts/` for replay. Strip `Authorization` headers, signed URLs with
   embedded tokens, and account identifiers from anything written to disk.
5. **Never commit an env file.** `.gitignore` covers `.env*` except the template.
   Verify with `git check-ignore -v .env.local` if you add a new one.
6. **Report a leak, don't paper over it.** If a key reaches a tracked file, a log,
   or a message: say so immediately and name the key. Rotating a fal or Veed key
   takes a minute; a quiet leak in a public repo does not stay quiet.

`artifacts/` is gitignored, but treat it as readable by anyone with the repo —
it gets zipped and shared during a hackathon.

## Adding a provider

1. Add the variable to `.env.example` with a comment naming the stage that needs
   it and the URL where a key is issued. Leave the value empty.
2. Add a `provider:VARIABLE` pair to `PROVIDERS` in `scripts/check-env.sh`.
3. Document the auth header in the stage's contract file under
   `codex/skills/<skill>/references/`.
4. Tell the humans to add the value to their own `.env.local` — do not distribute
   a key through the repo, an issue, or a chat message.

Current providers:

| Provider | Variable | Stage | Auth header |
| --- | --- | --- | --- |
| fal.ai | `FAL_KEY` | `slide_images`, `voiceover_video`, `talking_head_intro` (intro audio), `stimulus_text_receipt` | `Authorization: Key $FAL_KEY` |
| Tavily | `TAVILY_API_KEY` | `topic_research` | `Authorization: Bearer $TAVILY_API_KEY` |
| Pioneer | `PIONEER_API_KEY` | `teaching_signal_validation`, `learner_edge_recommendation` | `X-API-Key: $PIONEER_API_KEY` |
| OpenAI Codex | `CODEX_API_KEY` | skill-driven gym authoring and orchestration | injected server-side into `@openai/codex-sdk` |

Veed.io is not a `FAL_KEY`-style REST provider — it is an MCP server. See
[MCP servers](#mcp-servers).

## MCP servers

Some stages talk to a provider through an MCP tool connection instead of a
REST call with an env-var key. There is one today:

| Server | Stage | Endpoint | Auth |
| --- | --- | --- | --- |
| VEED Fabric | `talking_head_intro` (video) | `https://www.veed.io/api/v1/mcp` (Streamable HTTP) | OAuth 2.0, per developer, via browser login |

Unlike the providers above, there is no key to put in `.env.local`. Each
developer authorizes their own VEED account once per client, and the
authorization is cached by that client (Claude Code or Codex), not by this
repo.

### Configuration

Both clients are pre-wired in this repo:

- **Claude Code** reads `.mcp.json` at the repo root (checked in, no secrets —
  it is just the server URL). The first tool call opens a browser to VEED's
  login page; after that, `claude mcp list` shows `veed-fabric` as connected.
- **Codex CLI** reads `.codex/config.toml` at the repo root (also checked in
  and secret-free). Run `codex mcp login veed-fabric` once to complete the
  OAuth flow before the first `live` or `test` call. If a Codex build predates
  Streamable HTTP MCP support, add `[features]\nexperimental_use_rmcp_client = true`
  above the `[mcp_servers."veed-fabric"]` block, or upgrade Codex.

Both configs point at the same server; there is nothing to keep in sync
beyond the URL.

### Dry-run still applies

`WORKFLOW_MODE` gates the MCP tool calls exactly like it gates fal requests —
`dry-run` emits the intended tool-call sequence and payloads without invoking
`veed-fabric` at all, so no VEED login or credit spend is needed to develop or
test the rest of the pipeline. See
`codex/skills/veed-talking-head/references/veed-contract.md`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `MISSING` from `check-env.sh` | key absent from `.env.local` | add it; no restart needed, the runner reads the file per invocation |
| 401 from a provider | key not in scope | you called the command directly instead of through `with-env.sh` |
| Key expands to empty inside `bash -c` | double quotes let the outer shell expand it first | use single quotes |
| `.env.local` shows in `git status` | `.gitignore` missing or overridden | `git check-ignore -v .env.local` should print a matching rule |
| Works locally, fails in CI | CI has no `.env.local` | inject via the CI secret store as real environment variables; precedence means they win automatically |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
