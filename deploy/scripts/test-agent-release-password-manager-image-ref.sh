#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKFLOW_PATH="${REPO_ROOT}/.github/workflows/agent-release.yml"

verify_step="$(
  awk '
    $0 ~ /^      - name: Verify bundled compose pins image digests$/ { capture = 1 }
    capture { print }
    capture && $0 ~ /^      - name: / && $0 !~ /Verify bundled compose pins image digests$/ {
      exit
    }
  ' "$WORKFLOW_PATH"
)"

if [[ -z "$verify_step" ]]; then
  echo "failed to locate verify step in agent-release.yml" >&2
  exit 1
fi

if [[ "$verify_step" != *'PASSWORD_MANAGER_API_IMAGE_REF="$('* ]]; then
  echo "verify step must resolve PASSWORD_MANAGER_API_IMAGE_REF before using it" >&2
  exit 1
fi

if [[ "$verify_step" != *'grep -Fxq "${PASSWORD_MANAGER_API_IMAGE_REF}" <<< "$refs"'* ]]; then
  echo "verify step no longer checks the Password Manager digest pin" >&2
  exit 1
fi

echo "agent-release password manager image ref check passed"
