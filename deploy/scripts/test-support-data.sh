#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SUPPORT_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/generate_support_data"

make_mock_docker() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

case "$1" in
  version)
    cat <<'OUT'
Client: Docker Engine - Community
 Version: 27.0.0
Server: Docker Engine - Community
 Version: 27.0.0
OUT
    ;;
  system)
    if [ "${2:-}" = "df" ]; then
      cat <<'OUT'
TYPE            TOTAL     ACTIVE    SIZE
Images          5         3         2GB
Volumes         3         3         1GB
OUT
    fi
    ;;
  compose)
    case "${2:-}" in
      version)
        echo "Docker Compose version v2.29.0"
        ;;
      config)
        cat <<'OUT'
services:
  web:
    environment:
      BETTER_AUTH_URL: https://ct-ops.example.com
      BETTER_AUTH_SECRET: compose-secret-value
      POSTGRES_PASSWORD: compose-postgres-value
OUT
        ;;
      ps)
        echo "NAME          SERVICE   STATUS"
        echo "ct-ops-web-1  web       running"
        ;;
      images)
        echo "SERVICE   IMAGE"
        echo "web       ghcr.io/carrtech-dev/ct-ops/web@sha256:abc"
        ;;
      logs)
        cat <<'OUT'
web-1  | ready BETTER_AUTH_URL=https://ct-ops.example.com
web-1  | leaked POSTGRES_PASSWORD=log-postgres-value
ingest | Authorization: Bearer log-bearer-token
OUT
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac
EOF

  chmod +x "${dir}/docker"
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  if grep -Fq "$needle" "$file"; then
    echo "unexpected sensitive value '$needle' found in $file" >&2
    sed -n '1,160p' "$file" >&2
    exit 1
  fi
}

main() {
  local tmpdir bundle mockbin out extract archive
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  bundle="${tmpdir}/ct-ops"
  mockbin="${tmpdir}/mockbin"
  mkdir -p "$bundle" "$mockbin"
  make_mock_docker "$mockbin"

  cat > "${bundle}/.env" <<'EOF'
BETTER_AUTH_URL=https://ct-ops.example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://ct-ops.example.com
BETTER_AUTH_SECRET=env-better-auth-secret
POSTGRES_PASSWORD=env-postgres-password
CT_OPS_LOADTEST_ADMIN_KEY=env-loadtest-key
WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:abc
EOF

  cat > "${bundle}/docker-compose.yml" <<'EOF'
services:
  web:
    image: ${WEB_IMAGE}
EOF
  echo "1.2.3" > "${bundle}/VERSION"
  cp "$SUPPORT_SCRIPT" "${bundle}/generate_support_data"
  chmod +x "${bundle}/generate_support_data"

  out="$(
    cd "$bundle" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" ./generate_support_data
  )"

  archive="$(find "$bundle" -maxdepth 1 -name 'ct-ops-support-data-*.tar.gz' -print | head -n1)"
  if [ -z "$archive" ]; then
    echo "support archive was not created" >&2
    echo "$out" >&2
    exit 1
  fi

  extract="${tmpdir}/extract"
  mkdir -p "$extract"
  tar -xzf "$archive" -C "$extract"

  local root
  root="$(find "$extract" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  test -f "${root}/environment.env"
  test -f "${root}/docker-compose-config.txt"
  test -f "${root}/docker-logs.txt"
  test -f "${root}/manifest.txt"

  grep -Fq "BETTER_AUTH_URL=https://ct-ops.example.com" "${root}/environment.env"
  grep -Fq "BETTER_AUTH_SECRET=[REDACTED]" "${root}/environment.env"
  grep -Fq "POSTGRES_PASSWORD=[REDACTED]" "${root}/environment.env"
  grep -Fq "CT_OPS_LOADTEST_ADMIN_KEY=[REDACTED]" "${root}/environment.env"

  assert_not_contains "${root}/environment.env" "env-better-auth-secret"
  assert_not_contains "${root}/environment.env" "env-postgres-password"
  assert_not_contains "${root}/environment.env" "env-loadtest-key"
  assert_not_contains "${root}/docker-compose-config.txt" "compose-secret-value"
  assert_not_contains "${root}/docker-compose-config.txt" "compose-postgres-value"
  assert_not_contains "${root}/docker-logs.txt" "log-postgres-value"
  assert_not_contains "${root}/docker-logs.txt" "log-bearer-token"

  if tar -tzf "$archive" | grep -Eq '(^|/)\.env$'; then
    echo "archive must not include raw .env" >&2
    tar -tzf "$archive" >&2
    exit 1
  fi

  echo "support data redaction tests passed"
}

main "$@"
