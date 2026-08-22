---
name: tambo-veed-app
description: How this project wires VEED video generation into a Tambo registry-only React app — Codex owns the event loop, ComponentRenderer mounts pre-made views, props are request ids not video URLs, FAL_KEY stays server-only, and the UI never awaits a render. Use when registering a TamboComponent, editing src/lib/registry.tsx, src/app/api/run, or src/app/api/codex/action, when a chat turn would hang on a video render, or when a component is about to spend money on a generation. Install `npx skills add tambo-ai/tambo` only for renderer/registry mechanics — this repo does not use Tambo Cloud. Companion endpoint docs live in `codex/skills/videos/skills/veed-fal-api`.
---

# Tambo × VEED (registry only)

Taste Labs renders lessons with Tambo's **low-level registry and renderer**, not Tambo Cloud. Codex (this Next.js app + the Python pipeline) decides which component to show and when to start a run. `@tambo-ai/react@1.3.0` supplies `TamboRegistryProvider` and `ComponentRenderer` only.

Pinned install:

```bash
npm install @tambo-ai/react@1.3.0 zod@^4.0.0 zod-to-json-schema@^3.25.1
```

Docs: [React SDK](https://docs.tambo.co/reference/react-sdk), [ComponentRenderer](https://docs.tambo.co/reference/react-sdk/providers#componentrenderer).

## Layout (this repo, 22 Aug 2026)

App lives at the worktree root, not under `codex/skills/ui/`.

| Path                                                                         | Role                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/app/page.tsx`                                                           | Product UI. Wraps `LessonApp`.                                                    |
| `src/app/layout.tsx`                                                         | Imports `src/styles/riso.css` (ported from `page/riso.css`).                      |
| `src/lib/registry.tsx`                                                       | `lessonComponents` + `LessonRuntime` (`TamboRegistryProvider`).                   |
| `src/lib/timing.ts`                                                          | Pure `buildBoundaries`. `tests/test_player_timing.mjs` imports this.              |
| `src/components/LessonApp.tsx`                                               | Registry + `CodexActionProvider` + `ComponentRenderer`.                           |
| `src/components/CodexActionProvider.tsx`                                     | `dispatch({ type, payload })` → `POST /api/codex/action`.                         |
| `src/components/{PromptComposer,LessonPlayer,NextChoices,TasteFeedback}.tsx` | Pre-made views. Look from `docs/riso-system.md`.                                  |
| `src/app/api/codex/action/route.ts`                                          | Event loop. Dry-run copies `codex/examples/fixture-run`. Never fal, never Tavily. |
| `src/app/api/run/route.ts`                                                   | `POST` → `{ status: "submitted", run_id }` in ~1s.                                |
| `src/app/api/run/[id]/route.ts`                                              | `GET` → status + script/manifest. 404 if unknown.                                 |
| `src/app/api/run/[id]/file/[...path]/route.ts`                               | Serves run assets for the player.                                                 |

`page/` remains the design-source / static harness until LessonPlayer is proven. Do not delete it.

## Do not configure

This app must not mount Tambo Cloud. `rg` on the names below should only hit comments or this skill:

- Tambo Cloud's root provider (the one that takes an API key)
- Tambo thread input / `.submit()`
- Tambo tools and MCP servers (pass `tools={[]}` `mcpServers={[]}`)
- Any `NEXT_PUBLIC_TAMBO_*` or Tambo API key env var
- Direct Pioneer-to-Tambo calls (there is no Pioneer here — the analogue is the educational-video pipeline / fal)

## The rule everything else follows from

**Never await a VEED / fal generation inside the UI event loop.**

`POST /api/codex/action` and `POST /api/run` return a **receipt** (`run_id`) immediately. `LessonPlayer` polls `GET /api/run/[id]` until `asset-manifest.json` is readable, then mounts. Dry-run copies the tracked fixture; it does not call fal.

```
topic typed
  → dispatch topic_submitted
  → POST /api/codex/action → startRun() → { run_id } in ~1s
  → blocks: [ LessonPlayer { run_id } ]
  → ComponentRenderer mounts LessonPlayer
  → LessonPlayer polls GET /api/run/[id] until ready
```

## Props are a request, not a result

```tsx
// ✅ small, cannot fabricate a payload
LessonPlayerSchema = z.object({
  run_id: z.string().optional(),
  runBase: z.string().optional(),
});

// ❌ the model (or Codex) must not invent a URL
z.object({ video_url: z.string() });
```

The player fetches its own data from `/api/run/[id]`. Same for NextChoices and TasteFeedback: they take `run_id`, not the A/B/C copy or a generated list of chips (chips are the taste-profile enum).

## Event loop

`CodexActionProvider` is local. Registered components emit:

| type              | payload                      | next blocks (dry-run)          |
| ----------------- | ---------------------------- | ------------------------------ |
| `topic_submitted` | `{ topic }`                  | `LessonPlayer { run_id }`      |
| `playback_ended`  | `{ run_id }`                 | `LessonPlayer` + `NextChoices` |
| `choice_selected` | `{ run_id, label: A\|B\|C }` | `TasteFeedback { run_id }`     |
| `taste_reaction`  | `{ run_id, reaction }`       | `PromptComposer`               |

Reactions are the `history.reactions` enum in `codex/contracts/taste-profile.schema.json`.

## Cost gate (when live generation is wired)

Live fabric still belongs on a **server** route that holds `FAL_KEY`. No `NEXT_PUBLIC_FAL_KEY`. Gate spend server-side (409 + `estimated_cost_usd`) before `fal.queue.submit`. The UI still only receives a request id. Endpoint prices: [veed-fal-api](../../../videos/skills/veed-fal-api/SKILL.md).

`probeAudioDuration` via `ffprobe` is not available on most serverless runtimes — probe client-side from `<audio>`, decode the header, or run the route on Node.

fal CDN URLs expire. Copy finished media into `artifacts/educational-video/{run_id}/` and serve through `/api/run/[id]/file/...`.

## Before shipping a VEED-touching view — checklist

1. Codex action returns a receipt, never awaits the render.
2. `FAL_KEY` appears in server-only files. Must return nothing:
   `rg -n 'NEXT_PUBLIC_FAL|VITE_FAL|EXPO_PUBLIC_FAL'`
3. No streamable-tool hint on anything that reaches fal.
4. `propsSchema` carries a request/id, never a `video_url`.
5. Registered in `src/lib/registry.tsx` with a description that says **when** to use it.
6. Look comes from `src/styles/riso.css` / `docs/riso-system.md`, not shadcn defaults.
