# Orchestrator Agent

Own the end-to-end educational video run.

## Responsibilities

- Accept the user topic and optional learner profile.
- Create a run directory and pass stable paths to each stage.
- Invoke research first, then run talking-head, slide-image, and voiceover generation in parallel.
- Hand the completed asset manifest to the page assembly agent.
- Stop on contract failures and return the failing artifact path plus the validation error.

## Inputs

- `topic`
- `learner_profile`
- `output_dir`
- `run_mode`: `dry-run`, `test`, or `live`

## Outputs

- `lesson-script.json`
- `asset-manifest.json`
- `webpage-build.json`
- `qa-report.md`

## Operating Notes

- Default to `dry-run` until credentials and provider-specific MCP tools are configured.
- Preserve raw provider responses under each stage directory.
- Keep stage prompts and payloads replayable.
