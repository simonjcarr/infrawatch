#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENTRYPOINT="${REPO_ROOT}/apps/web/entrypoint.sh"

run_entrypoint() {
  local workspace="$1"
  shift

  mkdir -p "${workspace}/bin" "${workspace}/agent-dist"
  cat > "${workspace}/bin/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "${MOCK_NODE_LOG:?MOCK_NODE_LOG must be set}"
EOF
  chmod +x "${workspace}/bin/node"

  (
    cd "$workspace"
    env -i \
      PATH="${workspace}/bin:/usr/bin:/bin" \
      MOCK_NODE_LOG="${workspace}/node.log" \
      AGENT_DIST_DIR="${workspace}/agent-dist" \
      "$@" \
      sh "$ENTRYPOINT"
  )
}

main() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  run_entrypoint "${tmpdir}/database-url" \
    DATABASE_URL="postgresql://ctops:secret@db:5432/ctops" \
    BETTER_AUTH_SECRET="test-secret" \
    BETTER_AUTH_URL="https://ct-ops"
  grep -Fxq "migrate.js" "${tmpdir}/database-url/node.log"
  grep -Fxq "server.js" "${tmpdir}/database-url/node.log"

  run_entrypoint "${tmpdir}/postgres-env" \
    POSTGRES_USER="ctops" \
    POSTGRES_PASSWORD='Pyth)n2475##' \
    POSTGRES_HOST="db" \
    POSTGRES_PORT="5432" \
    POSTGRES_DB="ctops" \
    BETTER_AUTH_SECRET="test-secret" \
    BETTER_AUTH_URL="https://ct-ops"
  grep -Fxq "migrate.js" "${tmpdir}/postgres-env/node.log"
  grep -Fxq "server.js" "${tmpdir}/postgres-env/node.log"

  set +e
  local output
  output="$(
    run_entrypoint "${tmpdir}/missing-db" \
      BETTER_AUTH_SECRET="test-secret" \
      BETTER_AUTH_URL="https://ct-ops" 2>&1
  )"
  local status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "expected entrypoint to fail without DATABASE_URL or POSTGRES_PASSWORD" >&2
    exit 1
  fi
  if [[ "$output" != *"POSTGRES_PASSWORD must be set when DATABASE_URL is not set"* ]]; then
    echo "expected missing database credential message, got:" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "web entrypoint environment tests passed"
}

main "$@"
