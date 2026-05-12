#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
START_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/start.sh"
ROOT_COMPOSE_FILE="${REPO_ROOT}/docker-compose.single.yml"
PASSWORD_MANAGER_RELEASE_DESCRIPTOR="${REPO_ROOT}/deploy/password-manager-release.json"

make_mock_bin() {
  local dir="$1"
  local log_file="$2"

  cat > "${dir}/docker" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "\$*" >> "${log_file}"

if [ "\$#" -ge 2 ] && [ "\$1" = "compose" ] && [ "\$2" = "version" ]; then
  exit 0
fi

if [ "\$#" -ge 3 ] && [ "\$1" = "compose" ] && [ "\$2" = "pull" ]; then
  exit 0
fi

if [ "\$#" -ge 3 ] && [ "\$1" = "compose" ] && [ "\$2" = "down" ] && [ "\$3" = "--remove-orphans" ]; then
  rm -f "${dir}/ports-in-use"
  exit 0
fi

if [ "\$#" -ge 7 ] && [ "\$1" = "compose" ] && [ "\$2" = "up" ] && [ "\$3" = "--force-recreate" ] && [ "\$4" = "--abort-on-container-exit" ]; then
  exit 0
fi

if [ "\$#" -ge 4 ] && [ "\$1" = "compose" ] && [ "\$2" = "exec" ] && [ "\$3" = "-T" ] && [ "\$4" = "db" ]; then
  printf 'false\n'
  exit 0
fi

if [ "\$#" -ge 3 ] && [ "\$1" = "compose" ] && [ "\$2" = "up" ] && [ "\$3" = "-d" ]; then
  exit 0
fi

echo "unexpected docker invocation: \$*" >&2
exit 99
EOF

  cat > "${dir}/ss" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [ -f "${dir}/ports-in-use" ]; then
  cat <<'SS'
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 0      4096   0.0.0.0:80       0.0.0.0:*
LISTEN 0      4096   0.0.0.0:443      0.0.0.0:*
SS
else
  cat <<'SS'
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
SS
fi
EOF

  chmod +x "${dir}/docker" "${dir}/ss"
}

main() {
  local tmpdir mockbin install_dir log_file output
  tmpdir="$(mktemp -d)"
  trap 'chmod -R u+w "'"$tmpdir"'" 2>/dev/null || true; rm -rf "'"$tmpdir"'"' EXIT

  mockbin="${tmpdir}/mockbin"
  install_dir="${tmpdir}/ct-ops"
  log_file="${tmpdir}/docker.log"
  mkdir -p "$mockbin" "$install_dir/deploy/nginx" "$install_dir/deploy/dev-tls" "$install_dir/deploy/tls"
  : > "${mockbin}/ports-in-use"
  make_mock_bin "$mockbin" "$log_file"

  cp "$START_SCRIPT" "$install_dir/start.sh"
  cp "$ROOT_COMPOSE_FILE" "$install_dir/docker-compose.yml"
  cp "$PASSWORD_MANAGER_RELEASE_DESCRIPTOR" "$install_dir/password-manager-release.json"
  printf 'nginx config\n' > "$install_dir/deploy/nginx/nginx.conf"
  printf 'dev cert\n' > "$install_dir/deploy/dev-tls/server.crt"
  printf 'dev key\n' > "$install_dir/deploy/dev-tls/server.key"
  printf 'live cert\n' > "$install_dir/deploy/tls/server.crt"
  printf 'live key\n' > "$install_dir/deploy/tls/server.key"
  cat > "$install_dir/.env" <<'EOF'
BETTER_AUTH_URL=https://ct-ops
BETTER_AUTH_TRUSTED_ORIGINS=https://ct-ops
BETTER_AUTH_SECRET=test-secret
POSTGRES_PASSWORD=test-password
AGENT_DOWNLOAD_BASE_URL=https://ct-ops
WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:1111111111111111111111111111111111111111111111111111111111111111
INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:2222222222222222222222222222222222222222222222222222222222222222
EOF

  output="$(
    cd "$install_dir" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" ./start.sh 2>&1
  )"

  if [[ "$output" != *"CT-Ops is starting."* ]]; then
    echo "expected start.sh to continue after restarting an existing stack, got:" >&2
    echo "$output" >&2
    exit 1
  fi

  if ! grep -q '^compose down --remove-orphans$' "$log_file"; then
    echo "expected docker compose down to be called" >&2
    cat "$log_file" >&2
    exit 1
  fi

  if grep -q 'the following ports are already bound on this host' <<<"$output"; then
    echo "expected port check to ignore the stack being restarted" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "start.sh restart port check test passed"
}

main "$@"
