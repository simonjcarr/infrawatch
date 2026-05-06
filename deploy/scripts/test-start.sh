#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
START_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/start.sh"
ROOT_COMPOSE_FILE="${REPO_ROOT}/docker-compose.single.yml"
PASSWORD_MANAGER_RELEASE_DESCRIPTOR="${REPO_ROOT}/deploy/password-manager-release.json"

make_mock_bin() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi

echo "docker should not be called past version check in this test" >&2
exit 99
EOF

  chmod +x "${dir}/docker"
}

main() {
  local tmpdir mockbin install_dir output status
  tmpdir="$(mktemp -d)"
  trap 'chmod -R u+w "'"$tmpdir"'" 2>/dev/null || true; rm -rf "'"$tmpdir"'"' EXIT

  mockbin="${tmpdir}/mockbin"
  install_dir="${tmpdir}/ct-ops"
  mkdir -p "$mockbin" "$install_dir/deploy/nginx" "$install_dir/deploy/dev-tls" "$install_dir/deploy/tls"
  make_mock_bin "$mockbin"

  cp "$START_SCRIPT" "$install_dir/start.sh"
  cp "$ROOT_COMPOSE_FILE" "$install_dir/docker-compose.yml"
  cp "$PASSWORD_MANAGER_RELEASE_DESCRIPTOR" "$install_dir/password-manager-release.json"
  printf 'nginx config\n' > "$install_dir/deploy/nginx/nginx.conf"
  printf 'dev cert\n' > "$install_dir/deploy/dev-tls/server.crt"
  printf 'dev key\n' > "$install_dir/deploy/dev-tls/server.key"
  cat > "$install_dir/.env" <<'EOF'
BETTER_AUTH_URL=https://ct-ops
BETTER_AUTH_TRUSTED_ORIGINS=https://ct-ops
BETTER_AUTH_SECRET=test-secret
POSTGRES_PASSWORD=test-password
AGENT_DOWNLOAD_BASE_URL=https://ct-ops
WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:1111111111111111111111111111111111111111111111111111111111111111
INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:2222222222222222222222222222222222222222222222222222222222222222
EOF

  chmod 555 "$install_dir/deploy/tls"

  set +e
  output="$(
    cd "$install_dir" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" ./start.sh 2>&1
  )"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "expected start.sh to fail when deploy/tls is not writable" >&2
    exit 1
  fi
  if [[ "$output" != *"TLS directory is not writable"* ]]; then
    echo "expected writable-directory error, got:" >&2
    echo "$output" >&2
    exit 1
  fi
  if [[ "$output" != *"sudo chown -R"* ]]; then
    echo "expected ownership repair hint, got:" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "start.sh TLS directory permission test passed"
}

main "$@"
