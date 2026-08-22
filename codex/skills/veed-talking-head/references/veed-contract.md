# Veed Contract

Talking-head video generation goes through **fal**, calling the
`veed/fabric-1.0` endpoint from `codex/tools/fal_media_agent.py` — the same
script and `FAL_KEY` used for slide images and voiceover. There is no MCP
server and no OAuth login for this stage; see `AGENTS.md` for the `FAL_KEY`
credential flow.

## `veed/fabric-1.0`

An image-to-video model: it takes a still image and an audio clip and
returns a video of the image's subject lip-syncing to the audio. It does not
do its own text-to-speech, so it needs the intro audio clip generated first.

Request:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `image_url` | string | yes | The presenter avatar image (`talking-head-avatar.png`), a fal-hosted URL. |
| `audio_url` | string | yes | The intro line the avatar should speak, a fal-hosted URL from `fal-ai/minimax/speech-2.6-turbo`. |
| `resolution` | `"720p"` \| `"480p"` | yes | `--video-resolution` / `FAL_VIDEO_RESOLUTION`, default `"720p"`. |

Response: `{"video": {"url": "...", "content_type": "video/mp4", ...}}`.

## Tool sequence (all inside `fal_media_agent.py`)

1. Submit the avatar image job to `fal-ai/z-image/turbo` (`build_avatar_image_payload`).
2. Submit the intro audio job to `fal-ai/minimax/speech-2.6-turbo`
   (`build_intro_audio_payload`) — in parallel with step 1 and the slide/voiceover jobs.
3. Once both complete, submit `veed/fabric-1.0` with their `image_url`/`audio_url`
   (`generate_talking_head_video`).
4. Poll the fal queue until `status` is a terminal state, exactly like every
   other fal request in this script (see `wait_for_result`).
5. Download the resulting `video.url` to `talking-head-intro.mp4`.

## Avatar image

`build_avatar_image_payload` uses a fixed prompt (`DEFAULT_AVATAR_PROMPT`) and
a seed derived from a constant key (`DEFAULT_AVATAR_SEED_KEY`), not the run
id — this keeps the same presenter across runs instead of generating a new
face every time, mirroring the fixed default character the old MCP-based
flow used. Re-run with a different prompt/seed (or point `image_url` at a
fixed hosted image) only when asked to use a different look.

## Script input

The audio clip's source text is `lesson_script.intro.talking_head_script`,
unmodified — see `build_intro_audio_payload` in `fal_media_agent.py`.

## Dry-run payloads

In `dry-run`, `fal_media_agent.py` does not call fal. It still writes:

- `talking-head-avatar-payload.json` — the fully-formed avatar image request
  (this one has no unknowns, so it is identical in dry-run and live).
- `talking-head-video-payload.json` — the intended `veed/fabric-1.0` request
  shape, with `image_url`/`audio_url` left `null` because nothing has been
  generated yet:

```json
{
  "run_id": "...",
  "endpoint": "veed/fabric-1.0",
  "resolution": "720p",
  "payload": { "image_url": null, "audio_url": null, "resolution": "720p" }
}
```

## Minimum metadata fields

`talking-head-metadata.json`:

- `provider`: `fal.ai`
- `endpoint`: `veed/fabric-1.0`
- `resolution`
- `job_id` (fal `request_id`)
- `output_path`
- `status`

Do not hide provider errors. Sanitized submit/response JSON for every request
in this stage lands under `02-content-generation/provider/`
(`talking-head-avatar-*`, `talking-head-intro-audio-*`,
`talking-head-video-*`) via the same `sanitize_provider_json` redaction used
for slides and voiceover — signed URLs and auth headers are stripped before
anything is written to disk.
