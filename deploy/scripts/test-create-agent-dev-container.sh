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
  local tmpdir mockbin log output
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  mockbin="${tmpdir}/mockbin"
  log="${tmpdir}/docker.log"
  mkdir -p "$mockbin"
  make_mock_docker "$mockbin"

  output="$(
    DOCKER_MOCK_LOG="$log" \
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" \
    "$SCRIPT" \
      --token tok_test \
      --name ctops-agent-test \
      --app-url http://host.docker.internal:3000 \
      --ingest host.docker.internal:9443
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
  if ! grep -Fq -- "CT_OPS_AGENT_INSTALL_URL=http://host.docker.internal:3000/api/agent/install\\?ingest=host.docker.internal%3A9443\\&skip_verify=true" "$log"; then
    echo "expected install URL with encoded ingest address and skip_verify" >&2
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
