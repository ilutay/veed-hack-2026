# Pioneer Gym UI — Tambo registry runtime

A local React app that uses **Tambo as a component registry and renderer only**.
No Tambo API key, no Tambo threads, no Tambo tools, no MCP, no Tambo agent.

Codex owns the loop: it calls Pioneer, decides which gym surface to show, and
sends a component command. This app resolves that command against the registry
and renders it. Learner interactions travel back to Codex through our own
`CodexActionProvider`, never through Tambo.

```
Codex --(component command)--> GymBlock -> ComponentRenderer -> gym component
  ^                                                                   |
  +----------------- CodexActionProvider.emit(event) <----------------+
```

## Run it

Two processes. The browser holds the Tambo registry; the bridge holds codex-cli.
There is no Tambo server — registry-only means there is nothing else to run.

```bash
npm install
npm run schema     # regenerate the Codex output schema from the zod registry
npm run bridge     # terminal 1 — codex bridge on 127.0.0.1:8787
npm run dev        # terminal 2 — UI on 127.0.0.1:5173 (proxies /api to the bridge)
```

Then open the UI. The learner talks to a tutor agent in a chat; every
message goes to Codex (`POST /api/turn`, with the learner's onboarding status
and taste attached) and Codex answers by naming one registered component:

```
ProfileGate → InterestSurvey → LevelQuiz → RecommendedTopics
  → StartLesson / PromptComposer → LessonVideo (bridge render)
  → NextChoices + TasteFeedback → next lesson …      (+ AgentNote for plain replies)
```

Clicks inside a surface follow deterministically (`src/onboarding/workflow.ts`)
without a model turn; only free text is interpreted by Codex, so "give me a
lesson" gets the composer while "teach me how DNS works" starts a render.

Profiles live on the bridge under `artifacts/profiles/<slug>/` (`PROFILE_ROOT`);
the browser only remembers which slug is signed in, plus the lesson library.
Onboarding research is two bridge jobs, each a tool run followed by a Codex turn:

- **quiz** — `codex/tools/onboarding_research.py --stage quiz` gathers sources
  with Tavily (live when `TAVILY_API_KEY` is set, otherwise a dry-run fixture),
  then Codex authors five placement questions about the learner's interests
  (grounded in the sources when they are live).
- **recommend** — the tool scores the answers and places the learner, then
  Codex authors three next topics from level, interests and goal.

The UI polls `GET /api/profile/:slug` while a stage is `researching`/`scoring`;
a failed stage surfaces with a retry. The `Agent` dock (preference chat) and
taste reactions nudge pace/depth/concreteness axes that the bridge folds into
the lesson-script prompt, so renders are pitched to the learner.

```bash
npm test           # 45 tests, no network
npm run test:live  # opt-in: one real codex-cli turn, rendered end to end
npm run typecheck
npm run build
```

## Reaching it from your laptop

Both servers bind to `127.0.0.1` on the remote host on purpose. Use an SSH
tunnel — it needs no firewall change and exposes nothing to the internet.

**You only need one tunnel.** Vite proxies `/api` to the bridge *server-side*,
so the browser only ever talks to port 5173.

```bash
# on your laptop
ssh -N -L 5173:127.0.0.1:5173 root@172.237.110.48
```

Then open <http://localhost:5173>. Keep both `npm run bridge` and `npm run dev`
running on the host (tmux is already there). HMR works through the tunnel.

If port 5173 is taken locally, map any local port to the remote 5173 —
`-L 3000:127.0.0.1:5173`, then browse to `localhost:3000`.

### Do not bind these to 0.0.0.0

`ufw` is inactive on this host and sshd sets `gatewayports no`, so a `--host`
flag or `-L` with a wildcard bind would put the bridge on the public internet.

**The bridge has no authentication.** Every `POST /api/turn` spends real tokens
on the ChatGPT account in `codex-runner`'s auth file, and the prompt is
attacker-controlled. Anyone who finds port 8787 can bill you and run arbitrary
prompts. Before it is exposed to anything wider than a tunnel it needs, at
minimum, a shared secret, a per-IP rate limit, and a turn budget.

### The lesson loop, concretely

```
browser  POST /api/lesson {topic}        -> 202 {jobId}   (renders in background)
  -> App appends an assistant message carrying a LessonVideo block with that jobId
  -> LessonVideo polls GET /api/lesson/{jobId} until status=completed
  -> plays /media/lessons/{jobId}/03-video/lesson-video.mp4
```

The bridge mints both the job id and the media URL. Nothing model-authored
reaches either, and `componentId` comes from `crypto.randomUUID()` in the app.
Vite proxies `/media` as well as `/api`, so this still needs one tunnel.

The render runs `fal_media_agent.py` (`fal-ai/z-image/turbo` slides,
`xai/tts/v1` voiceover) then `assemble_slideshow_video.py` (ffmpeg). Codex is
called only for the script-authoring stage.

The media stage is pinned to `--mode live`, because the agent's `dry-run`
default writes payload stubs instead of assets and the assembler would find
nothing to mux. Live requires `FAL_KEY` in the bridge process's environment
and bills per render; without it the stage exits non-zero and the job reports
`failed` with that message. Set `LESSON_MEDIA_MODE=dry-run` to exercise the
job API without spending anything — the render will fail at assembly, which
is the point.

### The gym loop, concretely

```
browser  POST /api/turn {state}
  -> bridge  sudo -u codex-runner codex exec --output-schema component-command.schema.json
  -> codex   returns {componentName, props} constrained to the registry
  -> browser ComponentRenderer resolves it -> gym component renders
  -> learner interacts -> CodexActionProvider.emit -> POST /api/turn again
```

`server/bridge.mjs` is the only thing that talks to codex-cli, and it runs it as
`codex-runner` — the sole account holding the auth file. The browser never sees
a credential. Ids (`componentId`, `episodeId`, `turnId`) are assigned by the
bridge, never by the model.

### Verified live

A real turn against `gpt-5.6-sol` returns a schema-valid command in ~5-8s, and
it adapts: a fresh-learner state yields `ProbeArena`; a state describing a wrong
answer with one retry left yields `TargetedRetryGym`. `npm run test:live`
asserts the returned name is in the registry allowlist, that its props pass the
same zod schema the renderer uses, and that the component reaches the DOM.

## Dependencies

Pinned for hackathon reproducibility:

| Package | Version | Why |
| --- | --- | --- |
| `@tambo-ai/react` | `1.3.0` (exact) | Registry + renderer. Current registry version. |
| `zod` | `^4.0.0` | Props schemas; zod 4 implements Standard Schema, which is what the renderer validates through. |
| `zod-to-json-schema` | `^3.25.1` | Declared peer of `@tambo-ai/react`. **Do not call it.** See below. |
| `@modelcontextprotocol/sdk` | `^1.27.1` | **Also a declared peer** of `@tambo-ai/react`, and easy to miss — npm auto-installs peers, so an omission only surfaces under `--legacy-peer-deps` or a strict CI install. We register no MCP servers; this is a peer-resolution requirement, not a feature. |

### `zod-to-json-schema` is incompatible with zod 4 — and fails silently

The pinned pair `zod@^4` + `zod-to-json-schema@^3.25.1` cannot be used together
for conversion. `zodToJsonSchema()` predates zod 4 and, given a v4 schema,
returns a bare `{"$schema": "..."}` — every property dropped, no error thrown.

```
zod-to-json-schema@3 -> {"$schema":"http://json-schema.org/draft-07/schema#"}
z.toJSONSchema  (v4)  -> {"type":"object","properties":{...},"required":[...]}
```

Use zod 4's native `z.toJSONSchema()`, as `scripts/emit-codex-schema.ts` does.
The package stays in `package.json` only to satisfy Tambo's peer dependency.
This silently produced an empty schema for Codex before it was caught.

### Codex structured outputs are stricter than JSON Schema

Two rejections worth knowing before writing an `--output-schema` file:

- `oneOf` is not permitted, and the root must be an object. The command schema
  is therefore a flat object with a `componentName` enum plus an `anyOf` over
  the prop shapes — so the schema does *not* enforce that the name matches the
  props. The client re-validates and each component guards its own props.
- Every object needs `additionalProperties: false`. zod omits it on nested
  objects, so the generator injects it everywhere.

### The bridge's work directory must be writable by `codex-runner`

`mkdtemp` creates a `0700` directory owned by the bridge's user; codex-cli runs
as `codex-runner` and cannot write `--output-last-message` into it. The bridge
widens it to `0777` for the turn and removes it afterwards.

## Layout

| Path | Role |
| --- | --- |
| `src/gym/schemas/index.ts` | Zod props schema per gym surface — the Codex↔client contract. |
| `src/gym/registry.ts` | `gymComponents`: the allowlist of names Codex may render. |
| `src/gym/GymRuntime.tsx` | `TamboRegistryProvider` with empty `tools` / `mcpServers`. |
| `src/gym/GymBlock.tsx` | Turns a Codex command into a `TamboComponentContent` and renders it. |
| `src/codex/CodexActionProvider.tsx` | Our event channel back to Codex. |
| `src/gym/components/` | The four gym surfaces + `GymRenderError`. |
| `src/codex/client.ts` | Browser -> bridge call for a gym turn. |
| `src/codex/lesson.ts` | Browser -> bridge call that starts a lesson render. |
| `src/thread/MessageThreadFull.tsx` | The chat surface. Ours, not Tambo's — see the file header. |
| `src/App.tsx` | Owns the transcript; turns a submitted topic into a LessonVideo block. |
| `server/bridge.mjs` | Runs codex-cli turns; the only holder of the codex path. |
| `scripts/emit-codex-schema.ts` | Generates the Codex output schema from the zod registry. |

## Verified behaviour of the Tambo seam

Everything below was checked against the shipped `@tambo-ai/react@1.3.0`
sources in `node_modules`, not inferred from docs. Each has a test.

### `ComponentRenderer` needs no client, key, or thread

Its only dependency is `useContext(TamboRegistryContext)`. It never touches the
network. `TamboRegistryProvider` alone is a complete integration — confirmed by
a test that makes `fetch` throw and still renders.

`threadId` and `messageId` are **required props** even though the upstream
docstring example omits them. We pass Codex's `episodeId` / `turnId`; they are
forwarded to `ComponentContentProvider`, which scopes per-component state.

### The fallback fires on first render unless you gate it

`TamboRegistryProvider` seeds `componentList` from `useState({})` and populates
it in an effect. So the first render of *any* block resolves against an empty
registry: `ComponentRenderer` logs
`[ComponentRenderer] Failed to render component … was not found` and paints
`fallback`. The correct component appears one tick later.

Ungated, `GymRenderError` therefore flashes on every well-formed block and
spams `console.error`. `GymBlock` defers mounting the renderer by one effect
tick so the registry is populated before it looks. This keeps the fallback
meaning *"Codex named a component we do not have"*.

### Invalid props are rendered anyway — `fallback` will not catch them

This is the most load-bearing correction to the plan. `fallback` is used **only
when the component name is missing from the registry**. On schema-validation
failure the renderer emits `console.warn("Props validation failed for component
X")` and **renders the component with the raw, unvalidated props**.

Consequences:

- Every gym component must tolerate bad and partial props on its own. All four
  accept `Partial<Props>` and render a pending state instead of throwing.
- Props also arrive partial *during streaming* (the renderer parses partial
  JSON each tick), so `choices.map(...)` without a guard throws on tick one.
- If you need hard rejection on invalid props, validate before constructing the
  block; the renderer will not do it for you.

### `propsSchema` is mandatory in practice

Registering a component with neither `propsSchema` nor the deprecated
`propsDefinition` throws at registration:
`Component X must have either propsSchema (recommended) or propsDefinition defined`.

### Test environment needs two browser stubs

`src/test-setup.ts` stubs `URL.createObjectURL` and `Worker`. The
`@tambo-ai/react` barrel pulls in `react-media-recorder` →
`media-encoder-host`, which starts a Worker from a blob URL **at module
evaluation time**. jsdom has neither, so without the stubs the suite fails to
collect before any test runs. This is voice-recording machinery, entirely off
the registry/renderer path.

### Node ESM cannot import the barrel directly

`import("@tambo-ai/react")` under plain Node fails with
`ERR_IMPORT_ATTRIBUTE_MISSING` — the ESM build imports `package.json` without a
`type: "json"` attribute. Bundlers (Vite, Next) are unaffected. Only relevant if
you try to import the SDK in a plain Node script.

## Deliberately absent

Per the integration brief, none of these are configured, and adding one moves
control out of Codex:

- `TamboProvider` / any Tambo API key
- Tambo threads, `useTamboThreadInput().submit()`
- Tambo tools, MCP servers
- Tambo's built-in agent
- Any direct Pioneer→Tambo call
