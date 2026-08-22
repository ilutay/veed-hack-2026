#!/usr/bin/env bash
# Run the educational-video pipeline end to end and print a per-stage timing table.
#
#   WORKFLOW_MODE=live scripts/with-env.sh scripts/run-pipeline.sh <run-id> <topic> [lesson-script.json]
#
# The script stage is an LLM authoring step, not a tool: pass a ready
# lesson-script.json as the third argument to time the tool stages alone, or
# leave it out to stop after research so an agent can write the script.
#
# Stage 0 (topic research) needs no fal access and takes a couple of seconds, so
# the fal endpoint warm-up runs underneath it rather than after it — see
# codex/tools/warm_fal_endpoints.py for why cold pools dominate the budget.
set -uo pipefail

RUN_ID="${1:?usage: run-pipeline.sh <run-id> <topic> [lesson-script.json]}"
TOPIC="${2:?usage: run-pipeline.sh <run-id> <topic> [lesson-script.json]}"
SCRIPT_JSON="${3:-}"
MODE="${WORKFLOW_MODE:-dry-run}"
OUT="artifacts/educational-video/$RUN_ID"

# time.time(), not time.monotonic(): each call is a fresh interpreter, and
# monotonic()'s epoch is per-process on some builds, so every reading would be
# a few milliseconds after "start".
now() { python3 -c 'import time; print(time.time())'; }
since() { python3 -c "print(f'{$(now)-$1:.2f}')"; }

T0=$(now)
declare -a ROWS

stage() { # name, then the command
  local name="$1"; shift
  local start; start=$(now)
  "$@" >"/tmp/pipeline-$RUN_ID-$name.log" 2>&1
  local rc=$?
  ROWS+=("$(printf '%-22s %7ss  %7ss  rc=%d' "$name" "$(since "$start")" "$(since "$T0")" "$rc")")
  if [ $rc -ne 0 ]; then
    echo "stage $name failed (rc=$rc); see /tmp/pipeline-$RUN_ID-$name.log" >&2
    printf '%s\n' "${ROWS[@]}" >&2
    exit $rc
  fi
}

# Warm fal underneath topic research; it must not gate anything.
python3 codex/tools/warm_fal_endpoints.py --mode "$MODE" >"/tmp/pipeline-$RUN_ID-warm.log" 2>&1 &
WARM_PID=$!

stage topic_research python3 codex/tools/topic_research.py \
  --topic "$TOPIC" --output-dir "$OUT" --run-id "$RUN_ID" --mode "$MODE"

if [ -z "$SCRIPT_JSON" ]; then
  wait $WARM_PID
  echo "research complete; write $OUT/lesson-script.json then re-run with it as arg 3" >&2
  printf '%s\n' "${ROWS[@]}"
  exit 0
fi

# Deliberately not waited on. If warming is still in flight the real jobs queue
# behind it on the same pool, which is the outcome warming exists to produce;
# blocking here would just move that wait earlier. In a real run the LLM script
# stage sits here and warming finishes underneath it for free.
stage content_generation python3 codex/tools/fal_media_agent.py \
  --script "$SCRIPT_JSON" --output-dir "$OUT" --run-id "$RUN_ID" --mode "$MODE"

stage video_assembly python3 codex/tools/assemble_slideshow_video.py \
  --content-dir "$OUT/02-content-generation" \
  --output "$OUT/03-video/lesson-video.mp4" --overwrite

echo
printf '%-22s %8s %8s\n' stage elapsed cumulative
printf '%s\n' "${ROWS[@]}"
printf '%-22s %7ss\n' TOTAL "$(since "$T0")"
wait $WARM_PID 2>/dev/null
sed 's/^/  /' "/tmp/pipeline-$RUN_ID-warm.log"
