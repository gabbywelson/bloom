#!/usr/bin/env bash
# Runs every workspace's `test` script and keeps the terminal readable:
# one summary line per package when it passes, the full output when it fails.
#   bun run test              # quiet
#   VERBOSE=1 bun run test    # everything
set -uo pipefail
cd "$(dirname "$0")/.."
export LOG_LEVEL="${LOG_LEVEL:-Warn}"

failed=()
for dir in packages/* apps/*; do
  [[ -f "$dir/package.json" ]] || continue
  name=$(jq -r .name "$dir/package.json")
  jq -e '.scripts.test' "$dir/package.json" >/dev/null || continue
  if [[ -n "${VERBOSE:-}" ]]; then
    echo "=== $name"
    (cd "$dir" && bun run test) || failed+=("$name")
    continue
  fi
  out=$(cd "$dir" && bun run test 2>&1)
  status=$?
  summary=$(printf '%s\n' "$out" | grep -E '^ *[0-9]+ (pass|fail)$|^Ran [0-9]+ tests' | tr '\n' ' ' | sed 's/  */ /g')
  if [[ $status -eq 0 ]]; then
    printf '✔ %-20s %s\n' "$name" "${summary:-no tests}"
  else
    printf '✘ %-20s %s\n' "$name" "${summary:-exited with status $status}"
    printf '%s\n' "$out" | sed 's/^/  │ /'
    failed+=("$name")
  fi
done

if (( ${#failed[@]} > 0 )); then
  echo "failed: ${failed[*]}"
  exit 1
fi
