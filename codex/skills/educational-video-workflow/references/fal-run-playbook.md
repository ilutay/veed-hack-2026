# fal Run Playbook

How to actually execute a fal media run, and how to delegate one without burning
minutes of agent time. Read `fal-media-contract.md` for the flags and payload
contract; this file covers running it.

## Run it directly when you can

The whole job is one command and an `ls`. If you already have repo context
loaded, run it yourself — delegating costs far more than it saves.

Measured: the generation takes ~8 seconds. A cold subagent spawned to run it took
**284–331 seconds**, because it re-derives the repo layout, the credential setup,
and the tuning rationale before it can start. That is a ~40x overhead on a
task with no parallelism to exploit and no long wait to absorb.

Delegate only when the run needs to happen off the main thread, or alongside
other work.

## Delegating: use a small model and forbid the report

When a subagent is warranted, the cost is dominated by its own token generation,
not the run. Three rules cut it by an order of magnitude:

1. **Use a small, fast model.** There is no reasoning in this task — it is one
   command and a file check.
2. **Forbid analysis and reporting.** Ask for one line back. Report writing was
   the single largest time sink in every slow run.
3. **Pre-form the command with absolute paths.** Sandbox refusals on `cd x && y`
   compounds and on `>` redirection cost round trips that dwarf the work.

Measured effect of applying all three:

| | Unconstrained, large model | Constrained, small model |
|---|---|---|
| Agent wall clock | 284–331s | **26s** |
| Tool calls | 18–42 | **3** |
| Tokens | 50–69k | **22k** |

## Delegation prompt

Substitute the run id and paths, then hand this over verbatim.

```
Generate slide images and a voiceover with the fal media agent. Just run it and
confirm the files landed. Do not analyse, benchmark, or write a report.

Credential rules (non-negotiable):
- Never read `.env.local` or follow its symlink. It holds a real API key.
- Never echo or print $FAL_KEY.
- The command below already routes the key correctly via scripts/with-env.sh.

Sandbox constraints — obey these or you will waste turns on refusals:
- Do NOT use `cd x && y` compound forms. Use the absolute paths exactly as given.
- Do NOT use output redirection (>, >>, 2>).
- Do NOT use `env VAR=x` as a wrapper before the command.

Step 1 — run this exact command, once. If it fails, report the error and stop;
do not retry.

  WORKFLOW_MODE=live {REPO}/scripts/with-env.sh python3 \
    {REPO}/codex/tools/fal_media_agent.py \
    --script {REPO}/artifacts/educational-video/{RUN_ID}/lesson-script.json \
    --output-dir {REPO}/artifacts/educational-video/{RUN_ID} \
    --run-id {RUN_ID} --mode live --poll-interval-seconds 0.5

Step 2 — confirm the files:

  ls -la {REPO}/artifacts/educational-video/{RUN_ID}/02-content-generation/slide-images/

Step 3 — reply with exactly the output folder path and whether all 7 files are
present (6 PNGs plus voiceover.mp3). Nothing else. No tables, no timings, no
commentary.

Do not open or view the images. Do not listen to or transcribe the audio.
```

## Do not have the agent judge the output

Image quality and narration are human calls. An agent describing what it thinks
an image shows is slow and unreliable, and it is the step most likely to send a
run down a long detour.

Keep automated checking to mechanical facts: files exist, byte sizes are
non-trivial, `file` reports real PNG/MPEG streams, and no signed URL or auth
header leaked into `02-content-generation/provider/*.json`. Surface the folder to
a human for anything else.

Note that automated audio verification is not available in a default macOS
checkout anyway: `ffprobe`, `ffmpeg`, and `whisper` are absent, and on-device
speech recognition is TCC-denied to terminal processes.

## After the run

The manifest lists `02-content-generation/talking-head-intro.mp4` with
`"provider": "pending"`. This tool never generates it, so that path will not
resolve. Expected, not a run failure — but do not treat "every manifest path
exists" as a success check.
