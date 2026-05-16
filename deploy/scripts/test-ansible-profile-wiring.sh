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
assert_contains "${REPO_ROOT}/apps/web/lib/db/schema/module-connections.ts" "module_connections"
assert_contains "${REPO_ROOT}/apps/web/lib/automation/ansible-api.ts" "getAnsibleModuleConnectionSummary"
assert_contains "${REPO_ROOT}/apps/web/lib/automation/ansible-api.ts" "buildSignedModuleRequestHeaders"
assert_contains "${REPO_ROOT}/apps/ansible-api/server.py" "ANSIBLE_API_SERVICE_TOKEN_ID"
assert_contains "${REPO_ROOT}/apps/ansible-api/server.py" "verify_service_request"
assert_contains "${REPO_ROOT}/deploy/customer-bundle/build-offline-installer.sh" "--profile ansible config --images"

echo "ansible module contract wiring test passed"
