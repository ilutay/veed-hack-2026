# Orchestrator Agent

Own the end-to-end educational video run.

## Responsibilities

- Accept the user topic and optional learner profile.
- Create a run directory and pass stable paths to each stage.
- Invoke `topic_research` first, then `research_script` from that brief.
- The instant `lesson-script.json` exists, launch the talking-head, slide-image,
  and voiceover branches together as separate subagents (Agent tool) in the
  same turn — do not run one branch to completion and then start the next.
  `talking_head_intro` (the VEED render) is the long pole at roughly 1-2
  minutes; starting it late roughly doubles the stage's wall-clock time for
  no benefit, since no branch depends on another's output.
- Hand the completed asset manifest to the page assembly agent once every
  branch subagent reports back.
- Stop on contract failures and return the failing artifact path plus the validation error.

## Inputs

- `topic`
- `learner_profile`
- `output_dir`
- `run_mode`: `dry-run`, `test`, or `live`

## Outputs

- `research-brief.json`
- `lesson-script.json`
- `asset-manifest.json`
- `webpage-build.json`

## Operating Notes

- Default to `dry-run` until credentials and provider-specific MCP tools are configured.
- Preserve raw provider responses under each stage directory.
- Keep stage prompts and payloads replayable.
