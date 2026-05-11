#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT-Ops — Start Script
#
# Production mode (default):  Pull images from GHCR and run the full stack.
# Local dev mode (--local):   Build everything from source, run the ingest
#                              service natively, and start the Next.js dev
#                              server with Turbopack hot reload.
#
# Usage:
#   ./start.sh                     Production: pull + run GHCR images
#   ./start.sh --local             Dev: build from source, hot reload
#   ./start.sh --local --db-only   Dev: start database only
#   ./start.sh --local --rebuild-agents  Dev: force-rebuild agent binaries
#   ./start.sh --down              Stop production stack
#   ./start.sh --local --down      Stop dev database
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCAL=false
DB_ONLY=false
DOWN=false
REBUILD_AGENTS=false

for arg in "$@"; do
  case "$arg" in
    --local)           LOCAL=true ;;
    --db-only)         DB_ONLY=true ;;
    --down)            DOWN=true ;;
    --rebuild-agents)  REBUILD_AGENTS=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ---- Handle --down ----
if $DOWN; then
  if $LOCAL; then
    docker compose -f docker-compose.dev.yml down
    echo "Dev database stopped."
  else
    docker compose -f docker-compose.single.yml down
    echo "Production stack stopped."
  fi
  exit 0
fi

# ---- First-run bootstrap: if .env is missing but .env.example is here, copy it ----
# and ask the user to review before continuing. We never want to silently
# boot with placeholder secrets.
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "Created .env from .env.example."
    echo "Edit .env to set your URLs, then re-run ./start.sh."
    echo ""
    exit 0
  else
    echo "ERROR: no .env and no .env.example found in $(pwd)" >&2
    exit 1
  fi
fi

# Load .env so values like AGENT_DOWNLOAD_BASE_URL are available both to
# this script and (via export) to the docker compose variable substitution
# that follows.
set -a
# shellcheck disable=SC1091
source .env
set +a

upsert_env_var() {
  local key="$1"
  local value="$2"

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
  ' .env > .env.tmp && mv .env.tmp .env

  chmod 600 .env
  export "${key}=${value}"
}

remove_legacy_password_manager_api_image_env() {
  if ! grep -q '^PASSWORD_MANAGER_API_IMAGE=' .env 2>/dev/null; then
    return 0
  fi

  echo "WARN: removing legacy PASSWORD_MANAGER_API_IMAGE from .env; CT-Ops now pins the bundled Password Manager API from deploy/password-manager-release.json." >&2
  awk '$0 !~ /^PASSWORD_MANAGER_API_IMAGE=/' .env > .env.tmp && mv .env.tmp .env
  chmod 600 .env
  unset PASSWORD_MANAGER_API_IMAGE
}

read_password_manager_digest_reference() {
  local descriptor="$1"
  sed -n 's/.*"digest_reference"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$descriptor" | head -n1
}

compose_service_image() {
  local compose_file="$1"
  local service_name="$2"

  awk -v name="$service_name" '
    $0 == "  " name ":" {
      in_block = 1
      next
    }
    in_block && $0 ~ /^  [^ ]/ {
      exit
    }
    in_block && $0 ~ /^[[:space:]]+image:[[:space:]]*/ {
      sub(/^[[:space:]]+image:[[:space:]]*/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }
  ' "$compose_file"
}

validate_password_manager_image_pin() {
  local compose_file="$1"
  local descriptor="$2"
  local expected api_image migrate_image

  if [ ! -f "$descriptor" ]; then
    echo "ERROR: missing Password Manager release descriptor: $descriptor" >&2
    exit 1
  fi

  expected="$(read_password_manager_digest_reference "$descriptor")"
  if [ -z "$expected" ]; then
    echo "ERROR: could not read digest_reference from $descriptor" >&2
    exit 1
  fi

  api_image="$(compose_service_image "$compose_file" password-manager-api)"
  migrate_image="$(compose_service_image "$compose_file" password-manager-migrate)"

  if [[ "$api_image" == *'PASSWORD_MANAGER_API_IMAGE'* || "$migrate_image" == *'PASSWORD_MANAGER_API_IMAGE'* ]]; then
    echo "ERROR: $compose_file still allows PASSWORD_MANAGER_API_IMAGE to override the bundled Password Manager API image." >&2
    exit 1
  fi

  if [ "$api_image" != "$expected" ] || [ "$migrate_image" != "$expected" ]; then
    echo "ERROR: Password Manager compose image does not match $descriptor." >&2
    echo "Expected: $expected" >&2
    echo "password-manager-api:     ${api_image:-<missing>}" >&2
    echo "password-manager-migrate: ${migrate_image:-<missing>}" >&2
    exit 1
  fi
}

should_start_ansible_profile() {
  local compose_file="$1"
  local instance_id="${CT_OPS_INSTANCE_ID:-ct-ops-dev}"
  local postgres_user="${POSTGRES_USER:-ctops}"
  local postgres_db="${POSTGRES_DB:-ctops}"
  local enabled

  if ! enabled="$(docker compose -f "$compose_file" exec -T db psql \
    -U "$postgres_user" \
    -d "$postgres_db" \
    -At \
    -v ON_ERROR_STOP=1 \
    -v instance_id="$instance_id" \
    -c "SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM instance_settings
      WHERE id = :'instance_id'
        AND COALESCE(metadata->'featureFlags'->>'automation.ansible', 'false') = 'true'
        AND COALESCE(metadata->'automationSettings'->>'provider', 'none') = 'ansible'
    ) THEN 'true' ELSE 'false' END;" 2>/dev/null)"; then
    echo "ERROR: could not read Ansible automation setting from the CT-Ops database." >&2
    echo "Check the db container logs, then re-run ./start.sh." >&2
    exit 1
  fi

  [ "$enabled" = "true" ]
}

remove_legacy_password_manager_api_image_env

require_openssl() {
  local purpose="$1"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: openssl is required to ${purpose}" >&2
    exit 1
  fi
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

find_python_for_ed25519() {
  local candidate
  local candidates=()

  if command -v python3 >/dev/null 2>&1; then
    candidates+=("$(command -v python3)")
  fi
  candidates+=("/opt/homebrew/bin/python3" "/usr/local/bin/python3")

  for candidate in "${candidates[@]}"; do
    [ -x "$candidate" ] || continue
    if "$candidate" - <<'EOF' >/dev/null 2>&1
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization
EOF
    then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

generate_password_manager_launch_keypair() {
  local tmpdir private_pem private_der public_der private_key public_key python_bin node_bin

  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ct-ops-pm-launch-key.XXXXXX")"
  private_pem="${tmpdir}/private.pem"
  private_der="${tmpdir}/private.der"
  public_der="${tmpdir}/public.der"

  if command -v openssl >/dev/null 2>&1 && openssl genpkey -algorithm ED25519 -out "$private_pem" >/dev/null 2>&1; then
    if ! openssl pkey -in "$private_pem" -outform DER -out "$private_der" >/dev/null 2>&1; then
      rm -rf "$tmpdir"
      echo "ERROR: failed to encode Password Manager launch-signing private key" >&2
      exit 1
    fi
    if ! openssl pkey -in "$private_pem" -pubout -outform DER | tail -c 32 > "$public_der"; then
      rm -rf "$tmpdir"
      echo "ERROR: failed to derive Password Manager launch-signing public key" >&2
      exit 1
    fi
  elif python_bin="$(find_python_for_ed25519)" && "$python_bin" - <<'EOF' 2>/dev/null
from base64 import b64encode
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

private_key = ed25519.Ed25519PrivateKey.generate()
public_key = private_key.public_key()

print(b64encode(private_key.private_bytes(
    encoding=serialization.Encoding.DER,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)).decode("ascii"))
print(b64encode(public_key.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)).decode("ascii"))
EOF
  then
    rm -rf "$tmpdir"
    return 0
  elif node_bin="$(find_optional_command node)"; then
    "$node_bin" - <<'EOF'
const { generateKeyPairSync } = require('node:crypto')

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
process.stdout.write(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') + '\n')
process.stdout.write(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') + '\n')
EOF
    rm -rf "$tmpdir"
    return 0
  else
    rm -rf "$tmpdir"
    echo "ERROR: generating Password Manager launch-signing keys requires OpenSSL with Ed25519 support, Python 3 with cryptography, or Node.js." >&2
    exit 1
  fi

  private_key="$(base64 < "$private_der" | tr -d '\n')"
  public_key="$(base64 < "$public_der" | tr -d '\n')"
  rm -rf "$tmpdir"

  printf '%s\n%s\n' "$private_key" "$public_key"
}

derive_password_manager_launch_public_key() {
  local private_key="$1"
  local tmpdir private_der public_der public_key python_bin node_bin

  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ct-ops-pm-launch-key.XXXXXX")"
  private_der="${tmpdir}/private.der"
  public_der="${tmpdir}/public.der"

  if ! printf '%s' "$private_key" | openssl base64 -d -A > "$private_der" 2>/dev/null; then
    rm -rf "$tmpdir"
    return 1
  fi

  if openssl pkey -inform DER -in "$private_der" -pubout -outform DER 2>/dev/null | tail -c 32 > "$public_der"; then
    public_key="$(base64 < "$public_der" | tr -d '\n')"
    rm -rf "$tmpdir"
    printf '%s\n' "$public_key"
    return 0
  fi

  if python_bin="$(find_python_for_ed25519)" && CT_PM_PRIVATE_KEY="$private_key" "$python_bin" - <<'EOF' 2>/dev/null
import base64
import os
from cryptography.hazmat.primitives import serialization

private_key = serialization.load_der_private_key(
    base64.b64decode(os.environ["CT_PM_PRIVATE_KEY"]),
    password=None,
)
print(base64.b64encode(private_key.public_key().public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)).decode("ascii"))
EOF
  then
    rm -rf "$tmpdir"
    return 0
  fi

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
    rm -rf "$tmpdir"
    return 0
  fi

  rm -rf "$tmpdir"
  return 1
}

ensure_password_manager_bootstrap() {
  local issuer trusted_origins cookie_secure instance_id generated_private_key generated_public_key keypair_output repaired_public_key

  if [ -z "${PASSWORD_MANAGER_DB_PASSWORD:-}" ]; then
    require_openssl "generate PASSWORD_MANAGER_DB_PASSWORD"
    upsert_env_var "PASSWORD_MANAGER_DB_PASSWORD" "$(openssl rand -hex 16)"
    echo "Generated PASSWORD_MANAGER_DB_PASSWORD and wrote it to .env."
  fi

  if [ -z "${CT_OPS_INSTANCE_ID:-}" ]; then
    require_openssl "generate CT_OPS_INSTANCE_ID"
    instance_id="ct-ops-$(openssl rand -hex 8)"
    upsert_env_var "CT_OPS_INSTANCE_ID" "$instance_id"
    echo "Generated CT_OPS_INSTANCE_ID and wrote it to .env."
  fi

  if [ -z "${PASSWORD_MANAGER_CT_OPS_AUDIENCE:-}" ]; then
    upsert_env_var "PASSWORD_MANAGER_CT_OPS_AUDIENCE" "ct-password-manager"
    echo "Set PASSWORD_MANAGER_CT_OPS_AUDIENCE in .env."
  fi

  if [ -z "${PASSWORD_MANAGER_CT_OPS_PRODUCT:-}" ]; then
    upsert_env_var "PASSWORD_MANAGER_CT_OPS_PRODUCT" "ct-password-manager"
    echo "Set PASSWORD_MANAGER_CT_OPS_PRODUCT in .env."
  fi

  issuer="${PASSWORD_MANAGER_CT_OPS_ISSUER:-${BETTER_AUTH_URL:-https://localhost}}"
  if [ -z "${PASSWORD_MANAGER_CT_OPS_ISSUER:-}" ]; then
    upsert_env_var "PASSWORD_MANAGER_CT_OPS_ISSUER" "$issuer"
    echo "Set PASSWORD_MANAGER_CT_OPS_ISSUER in .env."
  fi

  trusted_origins="${PASSWORD_MANAGER_TRUSTED_ORIGINS:-${BETTER_AUTH_TRUSTED_ORIGINS:-$issuer}}"
  if [ -z "${PASSWORD_MANAGER_TRUSTED_ORIGINS:-}" ]; then
    upsert_env_var "PASSWORD_MANAGER_TRUSTED_ORIGINS" "$trusted_origins"
    echo "Set PASSWORD_MANAGER_TRUSTED_ORIGINS in .env."
  fi

  if [ -z "${PASSWORD_MANAGER_SESSION_COOKIE_SECURE:-}" ]; then
    case "$issuer" in
      https://*) cookie_secure="true" ;;
      *) cookie_secure="false" ;;
    esac
    upsert_env_var "PASSWORD_MANAGER_SESSION_COOKIE_SECURE" "$cookie_secure"
    echo "Set PASSWORD_MANAGER_SESSION_COOKIE_SECURE in .env."
  fi

  if [ -n "${PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY:-}" ]; then
    if repaired_public_key="$(derive_password_manager_launch_public_key "$PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY")"; then
      if [ "${PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY:-}" != "$repaired_public_key" ]; then
        upsert_env_var "PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY" "$repaired_public_key"
        PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY="$repaired_public_key"
        echo "Repaired Password Manager launch-signing public key in .env."
      fi
    else
      upsert_env_var "PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY" ""
      upsert_env_var "PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY" ""
      PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY=""
      PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY=""
      echo "Discarded invalid Password Manager launch-signing keypair from .env."
    fi
  fi

  if [ -z "${PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY:-}" ] || [ -z "${PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY:-}" ]; then
    keypair_output="$(generate_password_manager_launch_keypair)"
    generated_private_key="$(printf '%s\n' "$keypair_output" | sed -n '1p')"
    generated_public_key="$(printf '%s\n' "$keypair_output" | sed -n '2p')"
    if [ -z "$generated_private_key" ] || [ -z "$generated_public_key" ]; then
      echo "ERROR: Password Manager launch-signing key generation returned an incomplete keypair." >&2
      exit 1
    fi

    upsert_env_var "PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY" "$generated_private_key"
    upsert_env_var "PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY" "$generated_public_key"
    echo "Generated Password Manager launch-signing keypair and wrote it to .env."
  fi
}

# Auto-generate BETTER_AUTH_SECRET on first run if blank. Written back to
# .env in place so subsequent runs reuse the same secret.
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  require_openssl "generate BETTER_AUTH_SECRET"
  GENERATED_SECRET=$(openssl rand -hex 32)
  upsert_env_var "BETTER_AUTH_SECRET" "$GENERATED_SECRET"
  echo "Generated BETTER_AUTH_SECRET and wrote it to .env."
fi

# Auto-generate POSTGRES_PASSWORD on first run if blank. The default
# "ctops" password in the example config must not reach production.
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  require_openssl "generate POSTGRES_PASSWORD"
  GENERATED_PG_PASS=$(openssl rand -hex 16)
  upsert_env_var "POSTGRES_PASSWORD" "$GENERATED_PG_PASS"
  echo "Generated POSTGRES_PASSWORD and wrote it to .env."
fi

ensure_password_manager_bootstrap
validate_password_manager_image_pin docker-compose.single.yml deploy/password-manager-release.json

# Generate dev TLS certificates for the ingest service if they don't exist
CERT_DIR="$SCRIPT_DIR/deploy/dev-tls"
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  echo "Generating dev TLS certificates..."
  mkdir -p "$CERT_DIR"

  # Collect all non-loopback IPv4 addresses to include as SANs so remote agents can connect
  if command -v ip &>/dev/null; then
    LOCAL_IPS=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print "IP:" a[1]}' | tr '\n' ',' | sed 's/,$//')
  else
    LOCAL_IPS=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print "IP:" $2}' | tr '\n' ',' | sed 's/,$//')
  fi
  SAN="DNS:ingest,DNS:localhost,DNS:ct-ops,IP:127.0.0.1"
  if [ -n "$LOCAL_IPS" ]; then
    SAN="${SAN},${LOCAL_IPS}"
  fi

  # Dev certs deliberately expire in 365 days. They are NOT for production —
  # production deployments must supply their own CA-issued certificates and
  # rotate them per their own cert-management policy. A short-lived dev cert
  # makes accidental production reuse fail loudly within a year.
  openssl req -x509 -newkey rsa:4096 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -sha256 -days 365 -nodes \
    -subj "/CN=ct-ops-ingest" \
    -addext "subjectAltName=${SAN}" 2>/dev/null
  echo "TLS certificates generated (SANs: ${SAN}, expiry: 365 days — dev only)."
fi

# =============================================================================
# PRODUCTION MODE (default — pulls from GHCR)
# =============================================================================
if ! $LOCAL; then
  # AGENT_DOWNLOAD_BASE_URL is the URL agents use to download new binaries.
  # It must be reachable from each agent host, not just from inside Docker.
  # Defaults to http://localhost:3000 for single-host dev; export it before
  # running this script for remote agents (e.g. AGENT_DOWNLOAD_BASE_URL=https://ct-ops.example.com).
  export AGENT_DOWNLOAD_BASE_URL="${AGENT_DOWNLOAD_BASE_URL:-http://localhost:3000}"
  echo "Agent download base URL: ${AGENT_DOWNLOAD_BASE_URL}"

  # Always pull the latest published images from GHCR. This is the production
  # install path — users running CT-Ops from Docker do not have a source
  # checkout to build from. To run a locally-built image instead, set
  # WEB_IMAGE / INGEST_IMAGE in your environment (or .env) before invoking this
  # script, or run `docker compose -f docker-compose.single.yml build` manually.
  docker compose -f docker-compose.single.yml pull db password-manager-db password-manager-migrate password-manager-api web migrate ingest nginx tls-init
  docker compose -f docker-compose.single.yml down
  echo "Running database migrations..."
  docker compose -f docker-compose.single.yml up --force-recreate --abort-on-container-exit --exit-code-from migrate migrate
  docker compose -f docker-compose.single.yml up --force-recreate --abort-on-container-exit --exit-code-from password-manager-migrate password-manager-migrate
  if should_start_ansible_profile docker-compose.single.yml; then
    echo "Ansible automation is enabled; starting optional ansible-api service."
    docker compose -f docker-compose.single.yml --profile ansible pull ansible-api
    docker compose -f docker-compose.single.yml --profile ansible up -d --pull always
  else
    docker compose -f docker-compose.single.yml up -d --pull always
  fi

  # The release-please manifest is baked into both web and ingest images at
  # build time. Nothing else for this script to do.
  exit 0
fi

# =============================================================================
# LOCAL DEV MODE (--local)
# Builds ingest + agents from source; runs ingest natively; starts Next.js
# with Turbopack for instant hot reload. No GitHub Actions wait required.
# =============================================================================

# ---- Bootstrap web app .env.local ----
if [ ! -f "apps/web/.env.local" ]; then
  if [ -f "apps/web/.env.example" ]; then
    cp apps/web/.env.example apps/web/.env.local
    chmod 600 apps/web/.env.local
    echo "Created apps/web/.env.local from .env.example."
  fi
fi

export POSTGRES_USER="${POSTGRES_USER:-ctops}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-ctops}"
export POSTGRES_DB="${POSTGRES_DB:-ctops}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"

# ---- Build agent binaries ----
# Built once and cached in apps/web/data/agent-dist/. Agents are served by
# the Next.js app at /api/agent/download. Re-run with --rebuild-agents or
# `make agent` to rebuild after source changes.
AGENT_DIST_DIR="$SCRIPT_DIR/apps/web/data/agent-dist"
if $REBUILD_AGENTS || [ ! -f "$AGENT_DIST_DIR/ct-ops-agent-linux-amd64" ]; then
  echo "Building agent binaries for all platforms (this may take a minute)..."
  make agent
  echo "Agent binaries ready."
else
  echo "Agent binaries found. Run 'make agent' or use --rebuild-agents to rebuild after source changes."
fi

# ---- Build ingest service ----
echo "Building ingest service..."
make ingest

# ---- Start database ----
echo "Starting dev database..."
docker compose -f docker-compose.dev.yml up -d

echo "Waiting for database to be healthy..."
until docker compose -f docker-compose.dev.yml exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 1
done
echo "Database ready."

# ---- Run migrations ----
echo "Running database migrations..."
cd apps/web
pnpm run db:migrate
cd "$SCRIPT_DIR"

if $DB_ONLY; then
  echo ""
  echo "Database running on localhost:${POSTGRES_PORT}."
  echo "Run the ingest service manually:"
  echo "  INGEST_TLS_CERT=$CERT_DIR/server.crt \\"
  echo "  INGEST_TLS_KEY=$CERT_DIR/server.key \\"
  echo "  INGEST_JWT_KEY_FILE=$SCRIPT_DIR/deploy/dev-ingest-data/jwt_key.pem \\"
  echo "  POSTGRES_USER=$POSTGRES_USER POSTGRES_PASSWORD=<redacted> POSTGRES_HOST=localhost POSTGRES_PORT=$POSTGRES_PORT POSTGRES_DB=$POSTGRES_DB \\"
  echo "  ./dist/ingest"
  echo ""
  echo "Run the Next.js dev server manually:  cd apps/web && pnpm dev"
  exit 0
fi

# ---- Prepare ingest data directory (JWT key is auto-generated here on first run) ----
INGEST_DATA_DIR="$SCRIPT_DIR/deploy/dev-ingest-data"
mkdir -p "$INGEST_DATA_DIR"

# ---- Cleanup handler ----
INGEST_PID=""
cleanup() {
  echo ""
  echo "Shutting down local dev services..."
  if [ -n "${INGEST_PID:-}" ]; then
    kill "$INGEST_PID" 2>/dev/null || true
    wait "$INGEST_PID" 2>/dev/null || true
  fi
  echo "Ingest stopped. Database is still running — stop it with: ./start.sh --local --down"
}
trap cleanup INT TERM EXIT

# ---- Start ingest service (native process, not a container) ----
echo "Starting ingest service (native process)..."
INGEST_TLS_CERT="$CERT_DIR/server.crt" \
INGEST_TLS_KEY="$CERT_DIR/server.key" \
INGEST_JWT_KEY_FILE="$INGEST_DATA_DIR/jwt_key.pem" \
POSTGRES_USER="$POSTGRES_USER" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
POSTGRES_HOST="localhost" \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_DB="$POSTGRES_DB" \
INGEST_AGENT_DOWNLOAD_BASE_URL="${AGENT_DOWNLOAD_BASE_URL:-http://localhost:3000}" \
INGEST_RELEASE_MANIFEST_PATH="$SCRIPT_DIR/.release-please-manifest.json" \
"$SCRIPT_DIR/dist/ingest" &
INGEST_PID=$!

# Background processes are exempt from set -e, so we must check manually.
# Give the process 2 seconds to either bind its ports or fail fast.
sleep 2
if ! kill -0 "$INGEST_PID" 2>/dev/null; then
  echo "" >&2
  echo "ERROR: Ingest service exited immediately. Check the output above for the cause." >&2
  echo "Common causes: port 9443/8080 already in use, missing TLS certs, DB unreachable." >&2
  exit 1
fi
echo "Ingest service running (PID: $INGEST_PID  gRPC :9443  HTTP/JWKS :8080)."

# ---- Start Next.js dev server (foreground) ----
echo ""
echo "Starting Next.js dev server (Turbopack)..."
echo "  Web UI:    http://localhost:3000"
echo "  gRPC:      localhost:9443"
echo "  DB:        localhost:${POSTGRES_PORT}"
echo "  Agents:    http://localhost:3000/api/agent/download"
echo ""
cd apps/web
pnpm dev
