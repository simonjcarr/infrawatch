#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ct-ops-dev}"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.dev-stack.yml"
DEV_DIR="${SCRIPT_DIR}/.dev"
DEV_ENV="${DEV_DIR}/dev.env"
WEB_ENV="${SCRIPT_DIR}/apps/web/.env.local"
INGEST_DATA_DIR="${SCRIPT_DIR}/deploy/dev-ingest-data"
INGEST_PID=""

DOWN=false
RESET=false
STATUS=false
CHECK=false
WRITE_CONFIG_ONLY=false
REBUILD_AGENTS=false
SKIP_AGENTS=false

usage() {
  cat <<'EOF'
CT-Ops local dev stack

Usage:
  ./dev-stack.sh                  Start the full local dev stack
  ./dev-stack.sh --down           Stop Docker services
  ./dev-stack.sh --reset          Stop and remove local dev volumes/config
  ./dev-stack.sh --status         Show local dev service status
  ./dev-stack.sh --check          Check local dev endpoints
  ./dev-stack.sh --rebuild-agents Rebuild agent binaries before starting
  ./dev-stack.sh --skip-agents    Do not build missing agent binaries

Open http://localhost:3000. The dev proxy listens on :3000 and forwards to
Next.js, Password Manager, and ingest running in Docker.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --down) DOWN=true ;;
    --reset) RESET=true ;;
    --status) STATUS=true ;;
    --check) CHECK=true ;;
    --write-config-only) WRITE_CONFIG_ONLY=true ;;
    --rebuild-agents) REBUILD_AGENTS=true ;;
    --skip-agents) SKIP_AGENTS=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

compose() {
  docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$DEV_ENV" -f "$COMPOSE_FILE" "$@"
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found in PATH" >&2
    exit 1
  fi
}

check_start_dependencies() {
  local missing=0

  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: required command 'docker' not found in PATH" >&2
    missing=1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: Docker Compose plugin is not available. Install Docker Desktop or Docker Engine with Compose." >&2
    missing=1
  elif ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker is installed but the daemon is not running." >&2
    missing=1
  fi

  if [ "$missing" -ne 0 ]; then
    echo "" >&2
    echo "Install/start the missing prerequisites, then re-run ./dev-stack.sh." >&2
    exit 1
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  mkdir -p "$(dirname "$file")"
  touch "$file"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^#?[[:space:]]*" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
  chmod 600 "$file"
}

read_env_var() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

generate_hex() {
  local bytes="$1"
  openssl rand -hex "$bytes"
}

read_password_manager_digest_reference() {
  sed -n 's/.*"digest_reference"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    deploy/password-manager-release.json | head -n1
}

find_optional_command() {
  local cmd="$1"
  local dir

  if command -v "$cmd" >/dev/null 2>&1; then
    command -v "$cmd"
    return 0
  fi

  for dir in /opt/homebrew/bin /usr/local/bin; do
    if [ -x "${dir}/${cmd}" ]; then
      printf '%s\n' "${dir}/${cmd}"
      return 0
    fi
  done

  return 1
}

generate_password_manager_launch_keypair() {
  local node_bin

  if node_bin="$(find_optional_command node)"; then
    "$node_bin" - <<'EOF'
const { generateKeyPairSync } = require('node:crypto')

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
process.stdout.write(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') + '\n')
process.stdout.write(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') + '\n')
EOF
    return 0
  fi

  echo "ERROR: Node.js is required to generate Password Manager launch-signing keys." >&2
  exit 1
}

derive_password_manager_launch_public_key() {
  local private_key="$1"
  local node_bin

  if node_bin="$(find_optional_command node)"; then
    CT_PM_PRIVATE_KEY="$private_key" "$node_bin" - <<'EOF'
const { createPrivateKey, createPublicKey } = require('node:crypto')

const privateKey = createPrivateKey({
  key: Buffer.from(process.env.CT_PM_PRIVATE_KEY, 'base64'),
  format: 'der',
  type: 'pkcs8',
})
process.stdout.write(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') + '\n')
EOF
    return 0
  fi

  return 1
}

ensure_dev_env() {
  local proxy_port next_port postgres_port ingest_http_port ingest_grpc_port app_url pm_image
  local private_key public_key keypair_output repaired_public_key

  need openssl
  need node

  mkdir -p "$DEV_DIR"
  touch "$DEV_ENV"
  chmod 600 "$DEV_ENV"

  proxy_port="$(read_env_var "$DEV_ENV" CT_OPS_DEV_PROXY_PORT)"
  next_port="$(read_env_var "$DEV_ENV" CT_OPS_DEV_NEXT_PORT)"
  postgres_port="$(read_env_var "$DEV_ENV" POSTGRES_PORT)"
  ingest_http_port="$(read_env_var "$DEV_ENV" CT_OPS_DEV_INGEST_HTTP_PORT)"
  ingest_grpc_port="$(read_env_var "$DEV_ENV" CT_OPS_DEV_INGEST_GRPC_PORT)"

  proxy_port="${proxy_port:-3000}"
  next_port="${next_port:-3001}"
  postgres_port="${postgres_port:-55432}"
  ingest_http_port="${ingest_http_port:-8080}"
  ingest_grpc_port="${ingest_grpc_port:-9443}"
  app_url="http://localhost:${proxy_port}"

  upsert_env_var "$DEV_ENV" COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  upsert_env_var "$DEV_ENV" CT_OPS_DEV_PROXY_PORT "$proxy_port"
  upsert_env_var "$DEV_ENV" CT_OPS_DEV_NEXT_PORT "$next_port"
  upsert_env_var "$DEV_ENV" CT_OPS_DEV_INGEST_HTTP_PORT "$ingest_http_port"
  upsert_env_var "$DEV_ENV" CT_OPS_DEV_INGEST_GRPC_PORT "$ingest_grpc_port"
  upsert_env_var "$DEV_ENV" CT_OPS_DEV_APP_URL "$app_url"
  if [ -z "$(read_env_var "$DEV_ENV" CT_OPS_DEV_NEXT_FLAGS)" ]; then
    upsert_env_var "$DEV_ENV" CT_OPS_DEV_NEXT_FLAGS "--turbopack"
  fi

  if [ -z "$(read_env_var "$DEV_ENV" POSTGRES_USER)" ]; then
    upsert_env_var "$DEV_ENV" POSTGRES_USER "ctops"
  fi
  if [ -z "$(read_env_var "$DEV_ENV" POSTGRES_DB)" ]; then
    upsert_env_var "$DEV_ENV" POSTGRES_DB "ctops"
  fi
  if [ -z "$(read_env_var "$DEV_ENV" POSTGRES_PASSWORD)" ]; then
    upsert_env_var "$DEV_ENV" POSTGRES_PASSWORD "$(generate_hex 16)"
  fi
  upsert_env_var "$DEV_ENV" POSTGRES_PORT "$postgres_port"

  if [ -z "$(read_env_var "$DEV_ENV" BETTER_AUTH_SECRET)" ]; then
    upsert_env_var "$DEV_ENV" BETTER_AUTH_SECRET "$(generate_hex 32)"
  fi
  upsert_env_var "$DEV_ENV" BETTER_AUTH_URL "$app_url"
  upsert_env_var "$DEV_ENV" BETTER_AUTH_TRUSTED_ORIGINS "$app_url"
  upsert_env_var "$DEV_ENV" REQUIRE_EMAIL_VERIFICATION "false"
  upsert_env_var "$DEV_ENV" CT_OPS_TRUST_PROXY_HEADERS "true"
  upsert_env_var "$DEV_ENV" AGENT_DOWNLOAD_BASE_URL "$app_url"
  upsert_env_var "$DEV_ENV" INGEST_WS_URL ""

  if [ -z "$(read_env_var "$DEV_ENV" PASSWORD_MANAGER_DB_PASSWORD)" ]; then
    upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_DB_PASSWORD "$(generate_hex 16)"
  fi
  if [ -z "$(read_env_var "$DEV_ENV" CT_OPS_INSTANCE_ID)" ]; then
    upsert_env_var "$DEV_ENV" CT_OPS_INSTANCE_ID "ct-ops-dev-$(generate_hex 4)"
  fi
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_ISSUER "$app_url"
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_AUDIENCE "ct-password-manager"
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_PRODUCT "ct-password-manager"
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_TRUSTED_ORIGINS "$app_url"
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_SESSION_COOKIE_SECURE "false"

  private_key="$(read_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY)"
  if [ -n "$private_key" ] && repaired_public_key="$(derive_password_manager_launch_public_key "$private_key" 2>/dev/null)"; then
    upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY "$repaired_public_key"
  else
    keypair_output="$(generate_password_manager_launch_keypair)"
    private_key="$(printf '%s\n' "$keypair_output" | sed -n '1p')"
    public_key="$(printf '%s\n' "$keypair_output" | sed -n '2p')"
    upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY "$private_key"
    upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY "$public_key"
  fi

  pm_image="$(read_password_manager_digest_reference)"
  if [ -z "$pm_image" ]; then
    echo "ERROR: could not read Password Manager image from deploy/password-manager-release.json" >&2
    exit 1
  fi
  upsert_env_var "$DEV_ENV" PASSWORD_MANAGER_API_IMAGE "$pm_image"
}

write_web_env() {
  # shellcheck disable=SC1090
  set -a; source "$DEV_ENV"; set +a

  cat > "$WEB_ENV" <<EOF
# Generated by ./dev-stack.sh. Do not commit.
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
BETTER_AUTH_TRUSTED_ORIGINS=${BETTER_AUTH_TRUSTED_ORIGINS}
CT_OPS_TRUST_PROXY_HEADERS=${CT_OPS_TRUST_PROXY_HEADERS}
REQUIRE_EMAIL_VERIFICATION=${REQUIRE_EMAIL_VERIFICATION}
AGENT_DOWNLOAD_BASE_URL=${AGENT_DOWNLOAD_BASE_URL}
AGENT_DIST_DIR=./data/agent-dist
INGEST_WS_URL=${INGEST_WS_URL}
INGEST_TLS_CERT=${SCRIPT_DIR}/deploy/dev-tls/server.crt
PASSWORD_MANAGER_CT_OPS_ISSUER=${PASSWORD_MANAGER_CT_OPS_ISSUER}
PASSWORD_MANAGER_CT_OPS_AUDIENCE=${PASSWORD_MANAGER_CT_OPS_AUDIENCE}
PASSWORD_MANAGER_CT_OPS_PRODUCT=${PASSWORD_MANAGER_CT_OPS_PRODUCT}
PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY=${PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY}
CT_OPS_INSTANCE_ID=${CT_OPS_INSTANCE_ID}
ANSIBLE_API_URL=http://localhost:18080
EOF
  chmod 600 "$WEB_ENV"
}

compose_service_running() {
  local service="$1"
  compose ps --status=running --services 2>/dev/null | grep -Fxq "$service"
}

check_port_available() {
  local port="$1"
  local label="$2"

  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: port ${port} is already in use (${label})." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

generate_dev_tls() {
  if [ ! -f deploy/dev-tls/server.crt ] || [ ! -f deploy/dev-tls/server.key ]; then
    deploy/scripts/gen-dev-tls.sh
  fi
}

wait_for_db() {
  local user db
  # shellcheck disable=SC1090
  set -a; source "$DEV_ENV"; set +a
  user="$POSTGRES_USER"
  db="$POSTGRES_DB"

  echo "Waiting for CT-Ops database..."
  until compose exec -T db pg_isready -U "$user" -d "$db" >/dev/null 2>&1; do
    sleep 1
  done
}

build_agent_binaries() {
  if $SKIP_AGENTS; then
    return 0
  fi

  if $REBUILD_AGENTS || [ ! -f apps/web/data/agent-dist/ct-ops-agent-linux-amd64 ]; then
    echo "Building agent binaries..."
    make agent
  fi
}

cleanup_legacy_ingest_pid() {
  if [ -f "$DEV_DIR/ingest.pid" ]; then
    local pid
    pid="$(cat "$DEV_DIR/ingest.pid" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$DEV_DIR/ingest.pid"
  fi
}

check_endpoints() {
  # shellcheck disable=SC1090
  set -a; source "$DEV_ENV"; set +a

  curl -fsS "${BETTER_AUTH_URL}/nginx-healthz" >/dev/null
  curl -fsS "${BETTER_AUTH_URL}/password-manager-api/healthz" >/dev/null
  curl -fsS "http://localhost:${CT_OPS_DEV_INGEST_HTTP_PORT}/healthz" >/dev/null
  echo "Dev stack endpoints are reachable."
}

show_status() {
  if [ -f "$DEV_ENV" ]; then
    # shellcheck disable=SC1090
    set -a; source "$DEV_ENV"; set +a
    echo "URL: ${BETTER_AUTH_URL:-http://localhost:3000}"
  fi
  if command -v docker >/dev/null 2>&1 && [ -f "$DEV_ENV" ]; then
    compose ps
  fi
}

ensure_dev_env
write_web_env

if $WRITE_CONFIG_ONLY; then
  echo "Wrote ${DEV_ENV} and ${WEB_ENV}."
  exit 0
fi

if $DOWN || $RESET; then
  need docker
  cleanup_legacy_ingest_pid
  if $RESET; then
    compose down -v --remove-orphans || true
    rm -rf "$DEV_DIR" "$WEB_ENV" "$INGEST_DATA_DIR"
    echo "Local dev stack reset."
  else
    compose down --remove-orphans || true
    echo "Local dev stack stopped. Data volumes are preserved."
  fi
  exit 0
fi

if $STATUS; then
  show_status
  exit 0
fi

if $CHECK; then
  check_endpoints
  exit 0
fi

check_start_dependencies

# shellcheck disable=SC1090
set -a; source "$DEV_ENV"; set +a

cleanup_legacy_ingest_pid

if ! compose_service_running dev-proxy; then
  check_port_available "$CT_OPS_DEV_PROXY_PORT" "dev proxy"
fi
if ! compose_service_running db; then
  check_port_available "$POSTGRES_PORT" "CT-Ops Postgres"
fi
if ! compose_service_running web-dev; then
  check_port_available "$CT_OPS_DEV_NEXT_PORT" "Next.js direct"
fi
check_port_available "$CT_OPS_DEV_INGEST_HTTP_PORT" "ingest HTTP"
check_port_available "$CT_OPS_DEV_INGEST_GRPC_PORT" "ingest gRPC"

generate_dev_tls
build_agent_binaries

echo "Starting Docker backing services..."
compose up -d db password-manager-db password-manager-migrate password-manager-api web-migrate web-dev ingest-dev dev-proxy
wait_for_db

echo ""
echo "CT-Ops dev stack is starting."
echo "  Web UI:          ${BETTER_AUTH_URL}"
echo "  Next.js direct:  http://localhost:${CT_OPS_DEV_NEXT_PORT}"
echo "  Ingest gRPC:     localhost:${CT_OPS_DEV_INGEST_GRPC_PORT}"
echo "  Postgres:        localhost:${POSTGRES_PORT}"
echo ""
echo "Stop Docker services later with: ./dev-stack.sh --down"
echo ""
echo "Tail logs with: docker compose --project-name $COMPOSE_PROJECT_NAME --env-file .dev/dev.env -f docker-compose.dev-stack.yml logs -f web-dev ingest-dev"
