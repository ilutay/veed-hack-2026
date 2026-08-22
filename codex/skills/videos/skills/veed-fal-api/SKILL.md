---
name: veed-fal-api
description: Call VEED's video models on fal.ai correctly — fabric-1.0 (image + audio → talking-head video), veed/lipsync (redub an existing video), veed/avatars (stock UGC presenters from text or audio). Covers endpoint routing, the per-second vs per-minute pricing trap, the no-optional-parameters contract, queue vs subscribe, and how to re-verify a schema or price before quoting it. Use when a prompt mentions VEED, Fabric 1.0, talking avatar, lip-sync, or an avatar/UGC video; when writing or reviewing code that calls a `veed/*` endpoint, `fal.subscribe`, `fal.queue.*`, `fal_client`, `@fal-ai/client`, `fal.run`, or `queue.fal.run`; when setting `FAL_KEY`; or when estimating what a generated video will cost. Schemas and prices verified 22 Aug 2026 — re-curl the llms.txt before quoting a cost.
---

# VEED on fal.ai

VEED publishes four inference endpoints on fal. All four return the same output — `{ "video": { "url", "content_type", "file_name", "file_size" } }` — and all four have **only required inputs**. There is no shared "VEED API"; each endpoint is separately priced and separately shaped.

All facts below verified 22 Aug 2026 against `https://fal.ai/models/<endpoint-id>/llms.txt`. See [Verify before you quote](#verify-before-you-quote).

## Pick the endpoint

| You have | You want | Endpoint | Required input |
| --- | --- | --- | --- |
| A still image + an audio track | That face talking | `veed/fabric-1.0` | `image_url`, `audio_url`, `resolution` |
| Same, but in a hurry | Faster, fal claims same quality, 25–33% dearer | `veed/fabric-1.0/fast` | `image_url`, `audio_url`, `resolution` |
| **An existing video** + new audio | The video redubbed in sync | `veed/lipsync` | `video_url`, `audio_url` |
| Only a script | A stock presenter reading it | `veed/avatars/text-to-video` | `avatar_id`, `text` |
| Only a voiceover | A stock presenter lip-synced to it | `veed/avatars/audio-to-video` | `avatar_id`, `audio_url` |

`avatar_id` is a 28-value enum (`emily_vertical_primary`, `marcus_side`, …) — full list and per-endpoint schemas in [references/endpoints.md](references/endpoints.md).

## The pricing-unit trap

**Fabric is billed per second of output. Everything else is billed per minute.** Skimming the numbers without the units understates fabric by ~30×.

| Endpoint | Listed price | Per minute of output |
| --- | --- | --- |
| `veed/fabric-1.0` 720p | $0.15 / second | **$9.00** |
| `veed/fabric-1.0` 480p | $0.08 / second | **$4.80** |
| `veed/fabric-1.0/fast` 720p | $0.20 / second | **$12.00** |
| `veed/fabric-1.0/fast` 480p | $0.10 / second | **$6.00** |
| `veed/lipsync` | $0.40 / minute | $0.40 |
| `veed/avatars/text-to-video` | $0.35 / minute | $0.35 |
| `veed/avatars/audio-to-video` | $0.30 / minute | $0.30 |

Consequences worth stating to the user before writing code:

- **If a video already exists, use `veed/lipsync`** — never re-render a frame through fabric to redub it. Same job, ~22× cheaper.
- **If the face doesn't have to be a specific person, use `veed/avatars/audio-to-video`** — a stock presenter costs 1/30th of fabric.
- Fabric earns its price only when the identity in the image is the point (a real client, a specific character, a photo the user supplied).

## Cost guardrail

Output duration equals input audio duration. There is no `duration` parameter and **no cap** — a 3-minute podcast through fabric 720p is ~$27, from one API call, with no warning.

- Estimate the cost from the audio length and **state it before submitting**, on the first call in a session and on any call whose audio the user hasn't already priced:

  ```bash
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO"   # seconds; accepts a URL or a local path
  # fabric 720p: seconds × 0.15   ·   fabric 480p: seconds × 0.08
  # per-minute endpoints: (seconds ÷ 60) × the rate in the table above
  ```
- Default to `"480p"` while developing; switch to 720p for the final render only.
- Iterate on a short audio clip, not the full track.

## No invented parameters

Every VEED schema is 100% required fields and **zero optional fields**. These do not exist on any `veed/*` endpoint and will be rejected or silently ignored:

`prompt` · `negative_prompt` · `seed` · `duration` · `fps` · `num_frames` · `guidance_scale` · `aspect_ratio` · `output_format` · `webhook` (as an input field)

`resolution` exists **only on the two fabric endpoints**, has no default, and is required — send it explicitly. Aspect ratio on the avatars endpoints is chosen by the `avatar_id` (`*_vertical_*` ids are portrait).

## Calling it

```bash
npm install --save @fal-ai/client     # or: pip install fal-client
export FAL_KEY="..."                  # keys: https://fal.ai/dashboard/keys
```

`@fal-ai/serverless-client` is deprecated — use `@fal-ai/client`.

Blocking call (fine for scripts and one-offs):

```ts
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("veed/fabric-1.0", {
  input: { image_url, audio_url, resolution: "480p" },
  logs: true,
  onQueueUpdate: (u) => {
    if (u.status === "IN_PROGRESS") u.logs.map((l) => l.message).forEach(console.log);
  },
});
result.data.video.url; // mp4
```

**In server code, prefer the queue** — fabric's runtime scales with audio length, so a blocking request holds a connection open for minutes:

```ts
const { request_id } = await fal.queue.submit("veed/fabric-1.0", {
  input: { image_url, audio_url, resolution: "720p" },
  webhookUrl: "https://your.app/webhooks/fal",
});
await fal.queue.status("veed/fabric-1.0", { requestId: request_id, logs: true });
await fal.queue.result("veed/fabric-1.0", { requestId: request_id });
```

Over plain HTTP: `POST https://queue.fal.run/veed/fabric-1.0` with `Authorization: Key $FAL_KEY`, then `GET .../requests/{id}/status` and `.../requests/{id}/response`. (`https://fal.run/<id>` is the synchronous variant.) Queue requests are never dropped, are retried up to 10× on runner failure, and **you are not billed for queue wait or for server errors** — so a failed generation is not a wasted charge.

## Files

`image_url` / `audio_url` / `video_url` accept a public URL, a base64 `data:` URI (convenient, slow for large files), or a fal CDN URL from `fal.storage.upload(file)` — the JS client auto-uploads a `File`/`Blob` passed directly. Fabric's playground lists jpg, jpeg, png, webp, gif, avif for images and mp3, ogg, wav, m4a, aac for audio.

**`FAL_KEY` is server-side only.** Never ship it to a browser, mobile app, or a client-side `VITE_`/`NEXT_PUBLIC_` variable — route calls through a server proxy (`https://fal.ai/docs/documentation/model-apis/inference/proxy-setup`).

## Verify before you quote

fal's catalog and prices change often, and the platform docs say outright: do not infer prices from anywhere but the model's own page. Before quoting a price or asserting a field exists, re-fetch in this order:

1. **`curl https://fal.ai/models/<endpoint-id>/llms.txt`** — markdown, ~4KB, generated from the same live metadata the platform serves, so it cannot drift from the real endpoint. Carries the full input/output schema, enum values, pricing, and runnable snippets. This is almost always sufficient.
2. `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint-id>` — machine-readable schema, when you need exact types.
3. `https://fal.ai/models/<endpoint-id>/api` — the human docs page. **327KB of Next.js HTML**; needs tag-stripping to read and adds nothing llms.txt lacks. Last resort.

Platform-wide: `https://fal.ai/llms.txt` (entry points), `https://fal.ai/docs/llms.txt` (doc index). Any docs page also serves markdown by appending `.md` to its URL.

If a schema here disagrees with a freshly-fetched llms.txt, **the llms.txt wins** — update this skill.
