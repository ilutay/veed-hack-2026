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

Then open the UI: it asks Codex for an opening exercise, renders it through the
registry, and sends each interaction back for the next one.

```bash
npm test           # 14 tests, no network
npm run test:live  # opt-in: one real codex-cli turn, rendered end to end
npm run typecheck
npm run build
```

### The loop, concretely

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
| `src/codex/client.ts` | Browser -> bridge call. The only network call the gym makes. |
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
