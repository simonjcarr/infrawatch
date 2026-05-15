#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCRIPT="${REPO_ROOT}/deploy/scripts/create-agent-dev-container.sh"

make_mock_docker() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log="${DOCKER_MOCK_LOG:?DOCKER_MOCK_LOG is required}"
printf '%q ' "$@" >> "$log"
printf '\n' >> "$log"

case "${1:-}" in
  network)
    if [ "${2:-}" = "inspect" ]; then
      exit 0
    fi
    ;;
  ps)
    exit 0
    ;;
  build)
    exit 0
    ;;
  run)
    exit 0
    ;;
  exec)
    if printf '%s\n' "$*" | grep -q 'test -d /run/systemd/system'; then
      exit 0
    fi
    if printf '%s\n' "$*" | grep -q 'systemctl is-system-running'; then
      echo "running"
      exit 0
    fi
    exit 0
    ;;
  logs)
    exit 0
    ;;
esac

echo "unexpected docker command: $*" >&2
exit 99
EOF

  chmod +x "${dir}/docker"
}

main() {
  local tmpdir mockbin log output dev_env
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  mockbin="${tmpdir}/mockbin"
  log="${tmpdir}/docker.log"
  dev_env="${tmpdir}/dev.env"
  mkdir -p "$mockbin"
  make_mock_docker "$mockbin"

  cat > "$dev_env" <<'EOF'
AGENT_DOWNLOAD_BASE_URL=http://dev-env-host:3000
CT_OPS_AGENT_CONTAINER_INGEST_ADDRESS=dev-env-host:9443
CT_OPS_ENROLMENT_TOKEN=dev_env_token
COMPOSE_PROJECT_NAME=ct-ops-dev-test
EOF

  output="$(
    DOCKER_MOCK_LOG="$log" \
    CT_OPS_DEV_ENV_FILE="$dev_env" \
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" \
    "$SCRIPT" \
      --name ctops-agent-test
  )"

  if ! grep -q -- "build -t ct-ops-agent-dev:ubuntu-24.04-systemd" "$log"; then
    echo "expected docker build command" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q -- "--name ctops-agent-test" "$log"; then
    echo "expected named docker run command" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q -- "--user root" "$log"; then
    echo "expected explicit root runtime user for systemd installer test" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q -- "--add-host host.docker.internal:host-gateway" "$log"; then
    echo "expected host gateway mapping" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q -- "--cgroupns=host" "$log"; then
    echo "expected host cgroup namespace for systemd" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q -- "--network ct-ops-dev-test_default" "$log"; then
    echo "expected dev stack Docker network" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -Fq -- "CT_OPS_ENROLMENT_TOKEN=dev_env_token" "$log"; then
    echo "expected enrolment token from dev env" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -Fq -- "CT_OPS_AGENT_INSTALL_URL=http://dev-env-host:3000/api/agent/install\\?ingest=dev-env-host%3A9443\\&skip_verify=true" "$log"; then
    echo "expected install URL with encoded ingest address and skip_verify" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -Fq -- "sh -euc tmp=\\\"\\\$\\(mktemp\\)\\\"\\;\\ curl\\ -fsSLk\\ \\\"\\\$CT_OPS_AGENT_INSTALL_URL\\\"\\ -o\\ \\\"\\\$tmp\\\"\\;\\ sh\\ \\\"\\\$tmp\\\"\\;\\ rm\\ -f\\ \\\"\\\$tmp\\\"" "$log"; then
    echo "expected non-pipeline installer execution" >&2
    cat "$log" >&2
    exit 1
  fi
  if [[ "$output" != *"docker exec -it ctops-agent-test journalctl -u ct-ops-agent -f"* ]]; then
    echo "expected log follow hint" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "create-agent-dev-container.sh command assembly test passed"
}

main "$@"
