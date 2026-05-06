#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

tmpdir="$(mktemp -d)"
trap 'rm -rf "'"$tmpdir"'"' EXIT

rendered="${tmpdir}/compose.rendered.yml"
expected_api_image="$(
  python3 - <<'EOF' "${REPO_ROOT}/deploy/password-manager-release.json"
import json
import sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print(json.load(fh)["digest_reference"])
EOF
)"

(
  cd "$REPO_ROOT"
  BETTER_AUTH_SECRET=build-time-placeholder \
    POSTGRES_PASSWORD=build-time-placeholder \
    docker compose -f docker-compose.single.yml config >"$rendered"
)

require_line() {
  local pattern="$1"

  if command -v rg >/dev/null 2>&1; then
    if rg -q "$pattern" "$rendered"; then
      return 0
    fi
  elif grep -Eq "$pattern" "$rendered"; then
    return 0
  fi

  echo "expected rendered compose to match: $pattern" >&2
  exit 1
}

service_block() {
  local service_name="$1"

  awk -v name="$service_name" '
    $0 == "  " name ":" {
      in_block = 1
      print
      next
    }
    in_block && $0 ~ /^  [^ ]/ {
      exit
    }
    in_block {
      print
    }
  ' "$rendered"
}

password_manager_api_block="$(service_block "password-manager-api")"
password_manager_db_block="$(service_block "password-manager-db")"
password_manager_migrate_block="$(service_block "password-manager-migrate")"

service_image() {
  local service_name="$1"

  service_block "$service_name" | awk '
    /^[[:space:]]+image:[[:space:]]*/ {
      sub(/^[[:space:]]+image:[[:space:]]*/, "")
      print
      exit
    }
  '
}

require_line '^  password-manager-db:$'
require_line '^  password-manager-migrate:$'
require_line '^  password-manager-api:$'
require_line '^volumes:$'
require_line '^  password_manager_db_data:$'

if [[ -z "$password_manager_api_block" || -z "$password_manager_db_block" || -z "$password_manager_migrate_block" ]]; then
  echo "expected rendered compose to include password manager service blocks" >&2
  exit 1
fi

if { command -v rg >/dev/null 2>&1 && rg -q 'PASSWORD_MANAGER_API_IMAGE' "${REPO_ROOT}/.env.example" "${REPO_ROOT}/docker-compose.single.yml"; } \
  || { ! command -v rg >/dev/null 2>&1 && grep -q 'PASSWORD_MANAGER_API_IMAGE' "${REPO_ROOT}/.env.example" "${REPO_ROOT}/docker-compose.single.yml"; }; then
  echo "PASSWORD_MANAGER_API_IMAGE must not be operator-facing or used by compose" >&2
  exit 1
fi

api_image="$(service_image "password-manager-api")"
migrate_image="$(service_image "password-manager-migrate")"
if [[ "$api_image" != "$expected_api_image" || "$migrate_image" != "$expected_api_image" ]]; then
  echo "password manager api and migrate images must match deploy/password-manager-release.json" >&2
  echo "expected: $expected_api_image" >&2
  echo "api:      ${api_image:-<missing>}" >&2
  echo "migrate:  ${migrate_image:-<missing>}" >&2
  exit 1
fi

if [[ "$password_manager_api_block" == *$'\n    ports:'* ]]; then
  echo "password-manager-api must not expose host ports" >&2
  exit 1
fi

if [[ "$password_manager_db_block" == *$'\n    ports:'* ]]; then
  echo "password-manager-db must not expose host ports" >&2
  exit 1
fi

if [[ "$password_manager_migrate_block" != *$'\n    entrypoint:\n      - /app/password-manager-migrate'* ]]; then
  echo "password-manager-migrate must run /app/password-manager-migrate" >&2
  exit 1
fi

if [[ "$password_manager_migrate_block" != *$'\n    depends_on:\n      password-manager-db:\n        condition: service_healthy'* ]]; then
  echo "password-manager-migrate must wait for password-manager-db health" >&2
  exit 1
fi

if [[ "$password_manager_api_block" != *$'\n    depends_on:\n      password-manager-db:\n        condition: service_healthy'* || "$password_manager_api_block" != *$'\n      password-manager-migrate:\n        condition: service_completed_successfully'* ]]; then
  echo "password-manager-api must wait for db health and successful migration" >&2
  exit 1
fi

if [[ "$password_manager_db_block" != *$'\n    volumes:\n      - type: volume\n        source: password_manager_db_data\n        target: /var/lib/postgresql/data'* ]]; then
  echo "password-manager-db must use the dedicated password_manager_db_data volume" >&2
  exit 1
fi

echo "password manager compose wiring test passed"
