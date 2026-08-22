Taste Labs

# Educational Video Workflow Scaffold

This repository contains a first-pass Codex workflow structure for generating educational video content from a learning topic.

The workflow is intentionally contract-first:

1. Research a topic and produce a structured lesson script.
2. Generate a short talking-head intro: a 5-second audio clip via fal, then a
   video via the VEED Fabric MCP server (see `AGENTS.md` → "MCP servers").
3. Generate slide images in parallel.
4. Generate voiceover video or timed narration assets.
5. Assemble the outputs into a webpage with slides and voiceover.

## Structure

```text
codex/
|-- workflows/
|   `-- educational-video.yaml
|-- subagents/
|   |-- orchestrator-agent.md
|   |-- research-script-agent.md
|   |-- talking-head-agent.md
|   |-- slide-image-agent.md
|   |-- voiceover-agent.md
|   `-- page-assembly-agent.md
|-- skills/
|   |-- educational-video-workflow/
|   |-- topic-research-script/
|   |-- veed-talking-head/
|   |-- slide-image-generation/
|   |-- voiceover-video-generation/
|   |-- slideshow-video-assembly/
|   `-- learning-page-assembly/
|-- contracts/
|   |-- lesson-script.schema.json
|   |-- asset-manifest.schema.json
|   `-- webpage-build.schema.json
|-- tools/
|   |-- fal_media_agent.py
|   `-- assemble_slideshow_video.py
`-- examples/
    |-- work-order.example.json
    |-- fixture-run/          # synthetic placeholders for schema tests
    `-- sample-slides-run/    # real fal output: slides, voiceover, timings
```

The `codex/skills/*/SKILL.md` files are written so they can later be promoted into real Codex skills. The `codex/subagents/*.md` files define the specialized agent briefs and expected handoffs.

## Rendering the video locally

`codex/examples/sample-slides-run/` is a finished content-generation stage, so
the ffmpeg assembly step runs offline with no credentials:

```bash
python3 codex/tools/assemble_slideshow_video.py \
  --content-dir codex/examples/sample-slides-run/02-content-generation \
  --output artifacts/educational-video/sample/03-video/lesson-video.mp4
```

See `codex/skills/slideshow-video-assembly/SKILL.md` for the flags and the
timing-fit policies.
