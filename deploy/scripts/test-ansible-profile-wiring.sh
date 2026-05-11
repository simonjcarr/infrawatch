#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

assert_contains() {
  local file="$1"
  local needle="$2"

  if ! grep -Fq -- "$needle" "$file"; then
    echo "expected ${file} to contain: ${needle}" >&2
    exit 1
  fi
}

assert_contains "${REPO_ROOT}/docker-compose.single.yml" "ansible-api:"
assert_contains "${REPO_ROOT}/docker-compose.single.yml" "- ansible"
assert_contains "${REPO_ROOT}/start.sh" "should_start_ansible_profile"
assert_contains "${REPO_ROOT}/start.sh" "metadata->'featureFlags'->>'automation.ansible'"
assert_contains "${REPO_ROOT}/start.sh" "--profile ansible"
assert_contains "${REPO_ROOT}/deploy/customer-bundle/start.sh" "should_start_ansible_profile"
assert_contains "${REPO_ROOT}/deploy/customer-bundle/start.sh" "metadata->'automationSettings'->>'provider'"
assert_contains "${REPO_ROOT}/deploy/customer-bundle/build-offline-installer.sh" "--profile ansible config --images"

echo "ansible profile wiring test passed"
