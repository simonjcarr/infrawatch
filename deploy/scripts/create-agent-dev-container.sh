#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKERFILE="${REPO_ROOT}/deploy/docker/agent-dev-container/Dockerfile"
DEV_ENV="${CT_OPS_DEV_ENV_FILE:-${REPO_ROOT}/.dev/dev.env}"

IMAGE_TAG="${CT_OPS_AGENT_DEV_IMAGE:-ct-ops-agent-dev:ubuntu-24.04-systemd}"
APP_URL="${CT_OPS_AGENT_APP_URL:-http://dev-proxy}"
INGEST_ADDRESS="${CT_OPS_AGENT_INGEST_ADDRESS:-ingest-dev:9443}"
CONTAINER_NAME="${CT_OPS_AGENT_CONTAINER_NAME:-ctops-agent-$(date -u +%Y%m%d%H%M%S)-${RANDOM}}"
ENROLMENT_TOKEN="${CT_OPS_ENROLMENT_TOKEN:-}"
DOCKER_NETWORK="${CT_OPS_AGENT_DOCKER_NETWORK:-}"
SKIP_VERIFY="true"
INSTALL_AGENT="true"

usage() {
  cat <<EOF
Usage: $0 [options]

Creates one long-lived Ubuntu container with systemd, then installs the CT-Ops
agent into it using the web install script.

Options:
  --token TOKEN          Enrolment token. Defaults to CT_OPS_ENROLMENT_TOKEN.
  --name NAME            Container name. Defaults to a unique ctops-agent-* name.
  --app-url URL          CT-Ops web URL reachable from the container.
                         Default: ${APP_URL}
  --ingest HOST:PORT     CT-Ops ingest address reachable from the container.
                         Default: ${INGEST_ADDRESS}
  --image TAG            Local image tag to build/use.
                         Default: ${IMAGE_TAG}
  --network NAME         Docker network containing the dev stack.
                         Default: COMPOSE_PROJECT_NAME_default from ${DEV_ENV}
  --no-skip-verify       Do not request TLS skip verification in the install script.
  --no-install           Create the container but do not run the agent installer.
  -h, --help             Show this help.

Examples:
  CT_OPS_ENROLMENT_TOKEN=tok_123 $0
  $0 --token tok_123 --name ctops-agent-a
  $0 --token tok_123 --app-url http://dev-proxy --ingest ingest-dev:9443
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

read_env_var() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

load_dev_env_defaults() {
  local project value

  if [ -z "${CT_OPS_AGENT_APP_URL:-}" ]; then
    value="$(read_env_var "$DEV_ENV" AGENT_DOWNLOAD_BASE_URL)"
    if [ -n "$value" ]; then
      APP_URL="${value%/}"
    fi
  fi

  if [ -z "${CT_OPS_AGENT_INGEST_ADDRESS:-}" ]; then
    value="$(read_env_var "$DEV_ENV" CT_OPS_AGENT_CONTAINER_INGEST_ADDRESS)"
    if [ -n "$value" ]; then
      INGEST_ADDRESS="$value"
    fi
  fi

  if [ -z "${CT_OPS_ENROLMENT_TOKEN:-}" ]; then
    value="$(read_env_var "$DEV_ENV" CT_OPS_ENROLMENT_TOKEN)"
    if [ -n "$value" ]; then
      ENROLMENT_TOKEN="$value"
    fi
  fi

  if [ -z "${CT_OPS_AGENT_DOCKER_NETWORK:-}" ]; then
    project="$(read_env_var "$DEV_ENV" COMPOSE_PROJECT_NAME)"
    if [ -n "$project" ]; then
      DOCKER_NETWORK="${project}_default"
    fi
  fi
}

urlencode() {
  local value="$1"
  local i char out=""
  for ((i = 0; i < ${#value}; i++)); do
    char="${value:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-]) out+="$char" ;;
      *) printf -v out '%s%%%02X' "$out" "'$char" ;;
    esac
  done
  printf '%s' "$out"
}

wait_for_systemd() {
  local name="$1"
  local attempt state

  for attempt in {1..30}; do
    if docker exec "$name" test -d /run/systemd/system >/dev/null 2>&1; then
      state="$(docker exec "$name" systemctl is-system-running 2>/dev/null || true)"
      case "$state" in
        running|degraded)
          return 0
          ;;
      esac
    fi
    sleep 1
  done

  docker logs "$name" >&2 || true
  die "systemd did not become ready in container ${name}"
}

load_dev_env_defaults

while [ "$#" -gt 0 ]; do
  case "$1" in
    --token)
      [ "$#" -ge 2 ] || die "--token requires a value"
      ENROLMENT_TOKEN="$2"
      shift 2
      ;;
    --name)
      [ "$#" -ge 2 ] || die "--name requires a value"
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --app-url)
      [ "$#" -ge 2 ] || die "--app-url requires a value"
      APP_URL="${2%/}"
      shift 2
      ;;
    --ingest)
      [ "$#" -ge 2 ] || die "--ingest requires a value"
      INGEST_ADDRESS="$2"
      shift 2
      ;;
    --image)
      [ "$#" -ge 2 ] || die "--image requires a value"
      IMAGE_TAG="$2"
      shift 2
      ;;
    --network)
      [ "$#" -ge 2 ] || die "--network requires a value"
      DOCKER_NETWORK="$2"
      shift 2
      ;;
    --no-skip-verify)
      SKIP_VERIFY="false"
      shift
      ;;
    --no-install)
      INSTALL_AGENT="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

require_command docker

if [ "$INSTALL_AGENT" = "true" ] && [ -z "$ENROLMENT_TOKEN" ]; then
  die "provide an enrolment token with --token, CT_OPS_ENROLMENT_TOKEN, or ${DEV_ENV}"
fi

if [ -n "$DOCKER_NETWORK" ] && ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  die "Docker network '${DOCKER_NETWORK}' does not exist. Start the dev stack first with ./dev-stack.sh."
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  die "container already exists: ${CONTAINER_NAME}"
fi

echo "Building ${IMAGE_TAG}..."
docker build -t "$IMAGE_TAG" -f "$DOCKERFILE" "$REPO_ROOT"

echo "Starting ${CONTAINER_NAME}..."
docker_run_args=(
  -d
  --name "$CONTAINER_NAME"
  --hostname "$CONTAINER_NAME"
  --user root
  --privileged
  --cgroupns=host
  --restart unless-stopped
  --add-host host.docker.internal:host-gateway
  --tmpfs /run
  --tmpfs /run/lock
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw
)
if [ -n "$DOCKER_NETWORK" ]; then
  docker_run_args+=(--network "$DOCKER_NETWORK")
fi
docker_run_args+=("$IMAGE_TAG")
docker run "${docker_run_args[@]}" >/dev/null

wait_for_systemd "$CONTAINER_NAME"

if [ "$INSTALL_AGENT" = "true" ]; then
  install_url="${APP_URL}/api/agent/install?ingest=$(urlencode "$INGEST_ADDRESS")"
  if [ "$SKIP_VERIFY" = "true" ]; then
    install_url="${install_url}&skip_verify=true"
  fi

  echo "Installing CT-Ops agent in ${CONTAINER_NAME}..."
  echo "Tip: the CT-Ops web app should have AGENT_DOWNLOAD_BASE_URL=${APP_URL} for container installs."
  docker exec \
    -e CT_OPS_ENROLMENT_TOKEN="$ENROLMENT_TOKEN" \
    -e CT_OPS_AGENT_INSTALL_URL="$install_url" \
    "$CONTAINER_NAME" \
    sh -euc 'tmp="$(mktemp)"; curl -fsSLk "$CT_OPS_AGENT_INSTALL_URL" -o "$tmp"; sh "$tmp"; rm -f "$tmp"'
fi

echo ""
echo "Container: ${CONTAINER_NAME}"
echo "Status:    docker exec -it ${CONTAINER_NAME} systemctl status ct-ops-agent"
echo "Logs:      docker exec -it ${CONTAINER_NAME} journalctl -u ct-ops-agent -f"
