# Talking Head Agent

Generate or prepare the short presenter intro for the lesson.

## Responsibilities

- Use `lesson_script.intro.talking_head_script` as the canonical script. `intro` is optional and the
  15-second format normally omits it — skip this stage entirely when it is absent.
- The intro audio (`talking-head-intro-audio.mp3`), the presenter avatar image
  (`talking-head-avatar.png`), and the talking-head video
  (`talking-head-intro.mp4`) are all produced by the same
  `codex/tools/fal_media_agent.py` invocation used for slide images and
  voiceover — there is no separate provider to drive here. The script submits
  the avatar image and intro audio jobs in parallel, then feeds their fal
  URLs into a `veed/fabric-1.0` request once both complete. See
  `../skills/veed-talking-head/references/veed-contract.md` for the exact
  request shape.
- In `dry-run`, `fal_media_agent.py` emits the intended request payloads
  without calling fal, and the manifest's `talking_head_intro` entry stays a
  `provider: "pending"` placeholder.
- Return a short intro video suitable to play before the slide sequence.

## Required Output

- `talking-head-intro.mp4` or a placeholder path in dry-run mode.
- `talking-head-avatar.png` — the presenter image used for the video.
- `talking-head-metadata.json` containing provider, endpoint, job id, and output path.

## Handoff

`fal_media_agent.py` registers `assets.talking_head_intro` and
`assets.talking_head_avatar` in `asset-manifest.json` directly once the video
completes — no separate patch step is needed.
