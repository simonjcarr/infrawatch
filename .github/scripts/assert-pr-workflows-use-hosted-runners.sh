#!/usr/bin/env bash
set -euo pipefail

failures=()
matches_file="$(mktemp)"
trap 'rm -f "$matches_file"' EXIT

while IFS= read -r workflow; do
  if ! grep -qE '^  pull_request:' "$workflow"; then
    continue
  fi

  if grep -nE '^[[:space:]]+runs-on:[[:space:]]*self-hosted[[:space:]]*$' "$workflow" >"$matches_file"; then
    while IFS= read -r match; do
      failures+=("${workflow}:${match}")
    done <"$matches_file"
  fi
done < <(find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

if [ "${#failures[@]}" -gt 0 ]; then
  printf 'pull_request workflows must not use literal self-hosted runners:\n' >&2
  printf '  %s\n' "${failures[@]}" >&2
  exit 1
fi
