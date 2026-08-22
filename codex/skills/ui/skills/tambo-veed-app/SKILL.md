---
name: tambo-veed-app
description: How this project wires VEED video generation into a Tambo generative-UI React app — the non-blocking submit/poll shape, request-object props instead of generated URLs, the mandatory server route for FAL_KEY, the cost gate, and the streaming/expiry gotchas. Use when registering a TamboComponent or TamboTool that touches video, when writing `src/lib/tambo.ts` or an `/api/veed` route, when a chat turn hangs while a video renders, when a `<video>` prop is undefined, when deciding whether a tool should be streamable, or when the agent is about to spend money on a generation. Covers only the Tambo×VEED seams — install `npx skills add tambo-ai/tambo` for Tambo mechanics and see the companion `veed-fal-api` skill in `codex/skills/videos/skills/` for endpoint schemas and prices.
---

# Tambo × VEED

This project puts a VEED talking-head generator behind a Tambo agent: the user asks in chat, the agent picks a component and calls a tool, a video renders. The two halves are individually well documented — the failure modes all live in the seam between them, and that is all this skill covers.

- **Tambo mechanics** (scaffolding, `TamboProvider`, registration, threads, MCP): `npx skills add tambo-ai/tambo` installs the official `generative-ui` and `build-with-tambo` skills. Don't reinvent them.
- **VEED endpoints, schemas, prices**: [codex/skills/videos/skills/veed-fal-api](../../../videos/skills/veed-fal-api/SKILL.md).

## Status: registry-only runtime scaffolded at `ui/` (22 Aug 2026)

This lives in `veed-hack-2026` (Taste Labs). A React app now exists at **`ui/`**
(repo root, branch `feat/tambo-integrate`) — not at `codex/skills/ui/`, which
stays a skills namespace. The paths named below (`src/lib/tambo.ts`,
`src/app/api/veed/route.ts`) still come from the Tambo Next.js quickstart and do
**not** exist; `ui/` is Vite + React 19, so a VEED integration needs its own
server, not a Next.js route handler.

Note the app deliberately uses Tambo as a **registry and renderer only** —
`TamboRegistryProvider` + `ComponentRenderer`, no `TamboProvider`, no API key,
no threads, no tools, no MCP. The tool-registration guidance in the rest of this
skill therefore does not apply as written: there is no Tambo agent to call a
`TamboTool`. Codex drives the loop and components emit events through
`src/codex/CodexActionProvider.tsx`. See `ui/README.md` for the verified
behaviour of that seam.

The companion VEED skill lives in the other workstream at `codex/skills/videos/skills/veed-fal-api/`.

## The rule everything else follows from

**Never await a VEED generation inside a Tambo tool.**

A Tambo tool is awaited inline while the assistant's turn streams. A fabric render is duration-proportional — minutes of wall clock for a minute of audio. `tool: async () => await fal.subscribe(...)` therefore holds a chat turn open for minutes and looks like a hang. (Whether Tambo enforces a hard tool timeout is unverified — design non-blocking regardless, and check before relying on a long await.)

The shape that works:

```
user message
  → tool  →  POST /api/veed  →  fal.queue.submit()  →  returns { request_id } in ~1s
  → agent renders <TalkingVideo request_id={...} />
  → the component polls /api/veed/[request_id] until COMPLETED
```

The tool returns a **receipt**, not a video. The component owns the waiting.

## Why the server route is mandatory

`TamboProvider` runs in the browser (`"use client"` on Next.js), so anything a Tambo tool does is client-side. `FAL_KEY` must never reach a browser bundle — no `NEXT_PUBLIC_FAL_KEY`, ever. The tool calls **our** route; only the route holds the key and talks to fal.

```ts
// src/lib/tools/veed.ts  — runs in the browser
export const generateTalkingVideoTool: TamboTool = {
  name: "generate_talking_video",
  description:
    "Start rendering a talking-head video from a still image and an audio track. Returns a job id immediately — the video is NOT ready when this returns.",
  tool: async ({ image_url, audio_url, resolution }) => {
    const res = await fetch("/api/veed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url, audio_url, resolution }),
    });
    const body = await res.json();
    // 409 is the cost gate, not a failure — return it so the agent can quote the
    // price and ask. Throwing here would strip the numbers the question needs.
    if (res.status === 409) return body;
    if (!res.ok) throw new Error(`veed: HTTP ${res.status}`);
    return body;
  },
  inputSchema: z.object({
    image_url: z.string().describe("Public URL of the still image of the subject"),
    audio_url: z.string().describe("Public URL of the speech audio; sets the video's length"),
    resolution: z.enum(["720p", "480p"]).describe("Use 480p unless the user asks for final quality"),
  }),
  // Both branches must be declarable, or the confirmation path fails validation.
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("submitted"),
      request_id: z.string(),
      seconds: z.number(),
      estimated_cost_usd: z.number(),
    }),
    z.object({
      status: z.literal("confirmation_required"),
      seconds: z.number(),
      estimated_cost_usd: z.number(),
    }),
  ]),
  // NOTE: no `annotations` — see "Never streamable" below.
};
```

## Never streamable

Do **not** put `annotations: { tamboStreamableHint: true }` on any VEED tool. Streamable tools are invoked repeatedly as arguments stream in; Tambo's own docs say not to use the hint on tools with side effects or API calls. Here each repeat is a *separately billed generation*. The hint is for idempotent state updates only.

## Props are a request, not a result

Tambo's `component-data-props` guidance: response time scales with the token count of the props the model has to generate. Worse here — a model asked for `video_url` will **invent** one.

```tsx
// ✅ small, and the model cannot fabricate the payload
const TalkingVideoProps = z
  .object({
    request_id: z.string().describe("Job id returned by generate_talking_video"),
  })
  .describe("Shows render progress, then plays the finished talking-head video");

// ❌ never — the model has no way to know this and will hallucinate a URL
z.object({ video_url: z.string(), duration: z.number() });
```

The component fetches its own data from `/api/veed/[request_id]`. Same rule for any list of past renders: generate a *query* (`{ limit, since }`), not the rows.

## Cost gate — the agent now decides when to spend

The model chooses when to call the tool, and output length is uncapped input-audio length. At 720p that is $0.15/second with no ceiling. Gate it **server-side**, where the user can't be talked past it:

```ts
// src/app/api/veed/route.ts — server only; FAL_KEY lives here
const RATE = { "720p": 0.15, "480p": 0.08 };          // USD per second
// $10 = ~66s at 720p, ~125s at 480p. Passes a normal talking-head clip;
// stops a 3-minute podcast ($27 at 720p). A cap that trips on every real
// input just teaches people to delete it — tune, but keep one.
const MAX_AUTO_SPEND_USD = 10.0;

const seconds = await probeAudioDuration(audio_url);   // see note below
const cost = seconds * RATE[resolution];
if (cost > MAX_AUTO_SPEND_USD) {
  return Response.json(
    { status: "confirmation_required", seconds, estimated_cost_usd: +cost.toFixed(2) },
    { status: 409 },
  );
}
const { request_id } = await fal.queue.submit("veed/fabric-1.0", {
  input: { image_url, audio_url, resolution },
});
return Response.json({
  status: "submitted",
  request_id,
  seconds,
  estimated_cost_usd: +cost.toFixed(2),
});
```

`probeAudioDuration` and `useVeedJob` (below) are placeholders — nothing implements them yet. Note that the obvious implementation, shelling out to `ffprobe`, spawns a subprocess and **is not available on most serverless/edge runtimes**. On Vercel edge or similar, read the duration client-side from an `<audio>` element, decode the header in the route, or run this route on a Node runtime.

Surface `estimated_cost_usd` in the component so the spend is visible in the thread. A 409 is a normal outcome — have the agent relay it and ask, not retry.

Also route redubs correctly: if the user already has a video, `veed/lipsync` does the same job for ~1/22nd the cost. Cheapest correct endpoint wins — the table is in [codex/skills/videos/skills/veed-fal-api](../../../videos/skills/veed-fal-api/SKILL.md).

## Two rendering gotchas

**Props are `undefined` while streaming** — all of them, required included. `<video src={undefined}>` is where this shows up as a visible bug. Gate on stream status, not truthiness:

```tsx
function TalkingVideo({ request_id }: z.infer<typeof TalkingVideoProps>) {
  const { propStatus } = useTamboStreamStatus<{ request_id: string }>();
  const ready = propStatus.request_id?.isSuccess;      // key is absent until first token
  const job = useVeedJob(ready ? request_id : undefined);

  if (!ready) return <Skeleton />;
  if (job.status === "FAILED") return <RenderFailed onRetry={...} />;
  if (job.status !== "COMPLETED") return <RenderProgress seconds={job.seconds} />;
  return <video src={job.url} controls playsInline />;
}
```

**fal CDN URLs expire; Tambo threads don't.** Tambo persists conversations, so a thread reopened next week re-renders this component against a stale link. Either the route copies the finished mp4 to our own storage and returns our URL, or the component handles a dead source with a re-render affordance. Don't persist a bare `v3.fal.media` URL as if it were durable.

## Before shipping a VEED tool — checklist

1. Tool returns a receipt, never awaits the render.
2. `FAL_KEY` appears in exactly one file, server-side. Must return nothing:
   `rg -n 'NEXT_PUBLIC_FAL|VITE_FAL|EXPO_PUBLIC_FAL'`
3. No `tamboStreamableHint` on anything that reaches fal. Review every hit:
   `rg -n -B8 'tamboStreamableHint' src | rg -i 'fal|veed|video'`
4. `propsSchema` carries a request/id, never a `video_url` or a generated payload.
5. Server-side spend cap with a 409 confirmation path, and `estimated_cost_usd` shown in the thread.
6. Every prop read with `?.` / `??`, render gated on `propStatus.<field>?.isSuccess`.
7. Finished video persisted somewhere durable, or expiry handled in the component.
8. Registered in `src/lib/tambo.ts` with a description that says **when** to use it, not just what it is.
