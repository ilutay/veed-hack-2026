#!/usr/bin/env bash
# Preflight credential check. Prints presence and length only — never values.
#
#   scripts/check-env.sh            # status of every known key
#   scripts/check-env.sh fal        # require fal credentials, exit 1 if missing
#   scripts/check-env.sh fal tavily # require both
#
# Veed.io is not covered here — it authenticates by OAuth through the VEED
# Fabric MCP server, not an env var. See "MCP servers" in AGENTS.md.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# provider:VARIABLE pairs. Add a line here when you add a REST/API-key provider.
# Veed.io is deliberately absent: the VEED Fabric MCP server authenticates by
# OAuth per developer (see "MCP servers" in AGENTS.md), so there is no env var
# for this script to check.
PROVIDERS="fal:FAL_KEY tavily:TAVILY_API_KEY"

var_for() { # provider -> variable name, empty if unknown
  local p entry
  for entry in $PROVIDERS; do
    p="${entry%%:*}"
    [ "$p" = "$1" ] && { echo "${entry#*:}"; return 0; }
  done
  return 1
}

report() { # variable name
  local name="$1" val
  eval "val=\${$name:-}"
  if [ -n "$val" ]; then
    printf '  %-16s set (%d chars)\n' "$name" "${#val}"
  else
    printf '  %-16s MISSING\n' "$name"
  fi
}

mode="${WORKFLOW_MODE:-dry-run}"

echo "mode: $mode"
echo "files:"
for f in .env .env.local; do
  if [ -f "$repo_root/$f" ]; then echo "  $f present"; else echo "  $f absent"; fi
done

echo "keys:"
for entry in $PROVIDERS; do report "${entry#*:}"; done

if [ "$mode" = "dry-run" ]; then
  echo "dry-run: no credentials required."
  exit 0
fi

status=0
for p in "$@"; do
  var="$(var_for "$p")" || {
    echo "unknown provider: $p" >&2
    status=1
    continue
  }
  eval "val=\${$var:-}"
  if [ -z "$val" ]; then
    echo "$var is required for provider '$p' in mode $mode" >&2
    status=1
  fi
done
exit $status
