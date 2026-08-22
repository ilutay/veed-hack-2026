# VEED endpoint schemas (fal.ai)

Verified 22 Aug 2026 from `https://fal.ai/models/<endpoint-id>/llms.txt`. Re-curl that file rather than trusting this page if anything looks off — it is generated from live platform metadata.

Every endpoint below returns the same output object:

```json
{
  "video": {
    "url": "https://v3.fal.media/files/.../out.mp4",
    "content_type": "video/mp4",
    "file_name": null,
    "file_size": null
  }
}
```

`File.url` is the only guaranteed field; `file_name` and `file_size` come back `null` in practice. Download the URL if you need the asset to persist — treat fal CDN links as temporary.

---

## `veed/fabric-1.0` — image → talking video

$0.08/sec (480p), $0.15/sec (720p). Endpoint: `https://fal.run/veed/fabric-1.0`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `image_url` | string | yes | Still image of the subject |
| `audio_url` | string | yes | Drives both speech and output duration |
| `resolution` | enum | yes | `"720p"` \| `"480p"` — no default |

```json
{
  "image_url": "https://v3.fal.media/files/koala/NLVPfOI4XL1cWT2PmmqT3_Hope.png",
  "audio_url": "https://v3.fal.media/files/elephant/Oz_g4AwQvXtXpUHL3Pa7u_Hope.mp3",
  "resolution": "720p"
}
```

## `veed/fabric-1.0/fast` — same, speed-optimised

$0.10/sec (480p), $0.20/sec (720p). **Identical input and output schema** to `veed/fabric-1.0` — swapping between them is a one-string change. fal describes it as the same quality with faster generation.

## `veed/lipsync` — redub an existing video

$0.40 per minute. Category: video-to-video. Endpoint: `https://fal.run/veed/lipsync`.

| Field | Type | Required |
| --- | --- | --- |
| `video_url` | string | yes |
| `audio_url` | string | yes |

No `resolution` — output follows the source video. This is the cheapest path by a wide margin whenever a video already exists.

## `veed/avatars/text-to-video` — stock presenter reads a script

$0.35 per minute. Endpoint: `https://fal.run/veed/avatars/text-to-video`.

| Field | Type | Required |
| --- | --- | --- |
| `avatar_id` | enum (28 values, below) | yes |
| `text` | string | yes |

Voice comes with the avatar — there is no voice parameter. The example script in fal's docs is newline-separated ad copy; line breaks appear to act as pacing.

## `veed/avatars/audio-to-video` — stock presenter lip-synced to your audio

$0.30 per minute. Endpoint: `https://fal.run/veed/avatars/audio-to-video`.

| Field | Type | Required |
| --- | --- | --- |
| `avatar_id` | enum (28 values, below) | yes |
| `audio_url` | string | yes |

Use this instead of fabric whenever the presenter's identity doesn't matter — it is ~1/30th the cost of fabric 720p.

---

## `avatar_id` enum

Shared by both avatars endpoints. `*_vertical_*` ids are portrait/9:16 (social); the rest are landscape. `primary` / `secondary` / `side` / `walking` are framing and pose variants. `any_male_*` / `any_female_*` are unnamed generic presenters.

**Vertical (portrait):**
`emily_vertical_primary`, `emily_vertical_secondary`, `marcus_vertical_primary`, `marcus_vertical_secondary`, `mira_vertical_primary`, `mira_vertical_secondary`, `jasmine_vertical_primary`, `jasmine_vertical_secondary`, `jasmine_vertical_walking`, `aisha_vertical_walking`, `elena_vertical_primary`, `elena_vertical_secondary`, `any_male_vertical_primary`, `any_female_vertical_primary`, `any_male_vertical_secondary`, `any_female_vertical_secondary`, `any_female_vertical_walking`

**Horizontal (landscape):**
`emily_primary`, `emily_side`, `marcus_primary`, `marcus_side`, `aisha_walking`, `elena_primary`, `elena_side`, `any_male_primary`, `any_female_primary`, `any_male_side`, `any_female_side`

Note the asymmetry: `mira` and `jasmine` exist only as vertical; `aisha` has only walking variants. Don't construct an id by combining a name with a suffix — pick from this list, and re-fetch the llms.txt if a value is rejected.

---

## Python

```python
import fal_client

result = fal_client.subscribe(
    "veed/fabric-1.0",
    arguments={"image_url": ..., "audio_url": ..., "resolution": "480p"},
    with_logs=True,
)
print(result["video"]["url"])
```

Queue equivalent: `handler = fal_client.submit(...)` → `handler.request_id`, `handler.status(with_logs=True)`, `handler.result()`. `submit_async()` returns an async handle. Status types are `Queued(position)`, `InProgress(logs)`, `Completed(logs, metrics)`.

## cURL

```bash
curl --request POST \
  --url https://fal.run/veed/fabric-1.0 \
  --header "Authorization: Key $FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{"image_url":"...","audio_url":"...","resolution":"480p"}'
```

Swap the host to `https://queue.fal.run/veed/fabric-1.0` for the queued form; the response carries `request_id`, `status_url`, `response_url`, `cancel_url`, and `queue_position`. Add `?logs=1` to a status poll for runner logs.
