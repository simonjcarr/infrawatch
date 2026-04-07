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
