#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Infrawatch — Start Script
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

# Auto-generate BETTER_AUTH_SECRET on first run if blank. Written back to
# .env in place so subsequent runs reuse the same secret.
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: openssl is required to generate BETTER_AUTH_SECRET" >&2
    exit 1
  fi
  GENERATED_SECRET=$(openssl rand -hex 32)
  # Portable in-place edit (BSD/GNU sed compatible).
  if grep -q '^BETTER_AUTH_SECRET=' .env; then
    awk -v s="$GENERATED_SECRET" '/^BETTER_AUTH_SECRET=/ {print "BETTER_AUTH_SECRET=" s; next} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    echo "BETTER_AUTH_SECRET=$GENERATED_SECRET" >> .env
  fi
  chmod 600 .env
  export BETTER_AUTH_SECRET="$GENERATED_SECRET"
  echo "Generated BETTER_AUTH_SECRET and wrote it to .env."
fi

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
  SAN="DNS:ingest,DNS:localhost,IP:127.0.0.1"
  if [ -n "$LOCAL_IPS" ]; then
    SAN="${SAN},${LOCAL_IPS}"
  fi

  openssl req -x509 -newkey rsa:4096 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -sha256 -days 3650 -nodes \
    -subj "/CN=infrawatch-ingest" \
    -addext "subjectAltName=${SAN}" 2>/dev/null
  echo "TLS certificates generated (SANs: ${SAN})."
fi

# =============================================================================
# PRODUCTION MODE (default — pulls from GHCR)
# =============================================================================
if ! $LOCAL; then
  # AGENT_DOWNLOAD_BASE_URL is the URL agents use to download new binaries.
  # It must be reachable from each agent host, not just from inside Docker.
  # Defaults to http://localhost:3000 for single-host dev; export it before
  # running this script for remote agents (e.g. AGENT_DOWNLOAD_BASE_URL=https://infrawatch.example.com).
  export AGENT_DOWNLOAD_BASE_URL="${AGENT_DOWNLOAD_BASE_URL:-http://localhost:3000}"
  echo "Agent download base URL: ${AGENT_DOWNLOAD_BASE_URL}"

  # Always pull the latest published images from GHCR. This is the production
  # install path — users running Infrawatch from Docker do not have a source
  # checkout to build from. To run a locally-built image instead, set
  # WEB_IMAGE / INGEST_IMAGE in your environment (or .env) before invoking this
  # script, or run `docker compose -f docker-compose.single.yml build` manually.
  docker compose -f docker-compose.single.yml pull db web ingest
  docker compose -f docker-compose.single.yml down
  docker compose -f docker-compose.single.yml up -d --pull always

  # Database migrations are applied automatically by the web container on
  # startup (its CMD runs `node migrate.js && node server.js`), and the
  # release-please manifest is baked into both web and ingest images at build
  # time. Nothing else for this script to do.
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

export POSTGRES_USER="${POSTGRES_USER:-infrawatch}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-infrawatch}"
export POSTGRES_DB="${POSTGRES_DB:-infrawatch}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"

# ---- Build agent binaries ----
# Built once and cached in apps/web/data/agent-dist/. Agents are served by
# the Next.js app at /api/agent/download. Re-run with --rebuild-agents or
# `make agent` to rebuild after source changes.
AGENT_DIST_DIR="$SCRIPT_DIR/apps/web/data/agent-dist"
if $REBUILD_AGENTS || [ ! -f "$AGENT_DIST_DIR/infrawatch-agent-linux-amd64" ]; then
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
  echo "  DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB} \\"
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
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}" \
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
