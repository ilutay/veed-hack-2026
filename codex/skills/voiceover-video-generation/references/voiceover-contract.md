# Voiceover Contract

## Minimum Request Fields

- `voice`
- `language`
- `segments`: ordered slide narration segments
- `target_duration_seconds`
- `run_id`

## Timing Output

Each timing entry must include:

- `slide_id`
- `start_seconds`
- `end_seconds`

If a provider cannot return precise timings, estimate timings from narration length and mark the timing metadata as estimated.
