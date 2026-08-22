#!/usr/bin/env bash
# Load repo env files, then exec the given command with them in scope.
#
#   scripts/with-env.sh curl -sS -H "Authorization: Key $FAL_KEY" ...
#   scripts/with-env.sh python codex/tools/generate_slides.py
#
# Precedence (later wins): .env  ->  .env.local  ->  already-exported shell vars.
# Values are never echoed. Use scripts/check-env.sh to inspect what is loaded.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-env.sh <command> [args...]" >&2
  exit 64
fi

# Snapshot vars that were already exported so the real shell keeps priority.
preexisting="$(export -p)"

for f in "$repo_root/.env" "$repo_root/.env.local"; do
  if [ -f "$f" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$f"
    set +a
  fi
done

eval "$preexisting"

exec "$@"
