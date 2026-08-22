# Sample Slides Run

A real, completed `content_generation` stage from a live fal run of the
"dot-com bubble" lesson. Checked in so the local video-assembly step can be
developed and demoed without spending provider credits.

```text
02-content-generation/
|-- slide-images/slide-01..06.png   1024x576 stills, one per slide
|-- voiceover.mp3                   32.6s, mono 24kHz (the real narration)
|-- narration-timings.json          slide boundaries — estimated, totalling 15s
|-- voiceover-payload.json          the xai/tts/v1 request that produced the audio
`-- slide-image-prompts.json        the fal-ai/z-image/turbo requests per slide
```

Render it:

```bash
python3 codex/tools/assemble_slideshow_video.py \
  --content-dir codex/examples/sample-slides-run/02-content-generation \
  --output artifacts/educational-video/sample/03-video/lesson-video.mp4
```

Note the deliberate defect: the timings claim a 15-second lesson while the
narration runs 32.6 seconds, because the script asked for 15s and the TTS voice
ignored the target durations. That is the normal case, not a broken fixture — it
is why `codex/skills/slideshow-video-assembly` fits the timeline to the audio
before rendering. Keep it as-is; it is the regression case for that logic.

Compare with `../fixture-run/`, which holds tiny synthetic placeholders for
schema-level tests rather than real media.
