#!/usr/bin/env bash
set -euo pipefail

# Load .env so values like AGENT_DOWNLOAD_BASE_URL, GITHUB_REPO_OWNER etc.
# are available both to this script and (via export) to the docker compose
# variable substitution that follows. docker compose also reads .env on its
# own, but we need these in the bash environment too because start.sh
# inspects them and prints warnings.
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Generate dev TLS certificates for the ingest service if they don't exist
CERT_DIR="./deploy/dev-tls"
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

# The database URL used by the Docker Compose stack — must match docker-compose.single.yml.
# Defined here as the single source of truth for the migration steps below.
DOCKER_DB_URL="postgresql://infrawatch:infrawatch@localhost:5432/infrawatch"

# Surface the agent version that release-please has pinned in the manifest.
# Both the web app and the ingest service read this same file, so a single
# release-please commit fully drives the agent rollout — no env-var bumping
# required. Agents will self-update on their next heartbeat after this runs.
if [ -f ".release-please-manifest.json" ] && command -v node &>/dev/null; then
  AGENT_VERSION=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync('.release-please-manifest.json','utf8')).agent || '') } catch (e) {}" 2>/dev/null || true)
  if [ -n "${AGENT_VERSION:-}" ]; then
    echo "Pinned agent version (from .release-please-manifest.json): v${AGENT_VERSION}"
  else
    echo "WARNING: .release-please-manifest.json has no 'agent' entry — agent auto-update will be disabled."
  fi
fi

# AGENT_DOWNLOAD_BASE_URL is the URL agents use to download new binaries.
# It must be reachable from each agent host, not just from inside Docker.
# Defaults to http://localhost:3000 for single-host dev; export it before
# running this script for remote agents (e.g. AGENT_DOWNLOAD_BASE_URL=https://infrawatch.example.com).
export AGENT_DOWNLOAD_BASE_URL="${AGENT_DOWNLOAD_BASE_URL:-http://localhost:3000}"
echo "Agent download base URL: ${AGENT_DOWNLOAD_BASE_URL}"

# GITHUB_REPO_OWNER / GITHUB_REPO_NAME let the web app lazily fetch agent
# binaries from GitHub Releases on first request and cache them in the
# agent_dist volume. Without these, only locally-built binaries are served.
if [ -z "${GITHUB_REPO_OWNER:-}" ] || [ -z "${GITHUB_REPO_NAME:-}" ]; then
  echo "WARNING: GITHUB_REPO_OWNER / GITHUB_REPO_NAME not set — the web app will not be able to fetch agent binaries from GitHub Releases."
fi

docker compose -f docker-compose.single.yml build web ingest
docker compose -f docker-compose.single.yml pull
docker compose -f docker-compose.single.yml down
docker compose -f docker-compose.single.yml up -d

# Wait for the DB to be ready, then apply all pending migrations directly from the
# host filesystem. This is the authoritative migration step:
#   - The web container image bakes in migration files at build time, so any migration
#     added after the last build may be absent from the image.
#   - Running from the host guarantees we always use the current source tree.
#   - DATABASE_URL is set explicitly to the Docker DB, not read from .env.local,
#     so this works correctly even when .env.local points elsewhere.
echo "Waiting for database to be ready..."
until docker compose -f docker-compose.single.yml exec db pg_isready -U infrawatch -d infrawatch &>/dev/null; do
  sleep 1
done
echo "Applying database migrations..."
if ! DATABASE_URL="$DOCKER_DB_URL" pnpm --filter web run db:migrate; then
  echo "ERROR: database migration failed — aborting."
  exit 1
fi
echo "Migrations applied successfully."
