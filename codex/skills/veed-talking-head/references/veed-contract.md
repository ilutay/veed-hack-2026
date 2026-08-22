# Veed Contract

Provider integration is intentionally stubbed until credentials and API details are added.

## Minimum Request Fields

- `script`: intro narration text.
- `duration_seconds`: target duration.
- `presenter`: configured avatar, template, or talking-head preset.
- `aspect_ratio`: default `16:9` unless the final webpage requires another format.
- `run_id`: workflow run id for traceability.

## Minimum Metadata Fields

- `provider`: `veed`
- `mode`: `dry-run`, `test`, or `live`
- `request_path`
- `response_path`
- `provider_job_id`
- `output_path`
- `status`

Do not hide provider errors. Preserve raw error payloads in the stage directory.
