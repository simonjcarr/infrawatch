#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT-Ops — Customer Start Script
#
# Pulls the published images from GHCR and runs the single-host stack defined
# in docker-compose.yml. This script is shipped in the customer install zip
# and is intended for operators running CT-Ops from a release bundle —
# not for working on the source tree.
#
# Usage:
#   ./start.sh             Start (or update) the stack
#   ./start.sh --logs      Tail logs from all containers
#   ./start.sh --down      Stop the stack (data is preserved)
#   ./start.sh --version   Show bundle / app version and licence tier
#   ./start.sh --help      Show this help and links to docs / support
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DOCS_URL="https://carrtech-dev.github.io/ct-ops/"
SUPPORT_URL="https://github.com/carrtech-dev/ct-ops/issues"

# Required variables — the stack will not start without these. start.sh either
# auto-generates them on first run (secrets) or refuses to continue (URLs).
REQUIRED_VARS=(BETTER_AUTH_URL BETTER_AUTH_TRUSTED_ORIGINS BETTER_AUTH_SECRET POSTGRES_PASSWORD)

# Optional variables — missing values get a warning, not an error. Most have
# safe localhost defaults baked into docker-compose.yml.
OPTIONAL_VARS=(AGENT_DOWNLOAD_BASE_URL INGEST_WS_URL CT_OPS_LOADTEST_ADMIN_KEY WEB_IMAGE INGEST_IMAGE)

show_help() {
  cat <<EOF
CT-Ops — single-host installer

Commands:
  ./start.sh             Start (or update) the stack
  ./start.sh --logs      Tail logs from all containers (Ctrl-C to stop)
  ./start.sh --down      Stop the stack (named volumes are preserved)
  ./start.sh --version   Show bundle version, app version and licence tier
  ./start.sh --help      Show this message

Documentation: ${DOCS_URL}
Support:       ${SUPPORT_URL}
EOF
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: 'docker' is not installed or not on PATH." >&2
    echo "Install Docker Engine 24+ with the Compose plugin: https://docs.docker.com/engine/install/" >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' plugin not found." >&2
    echo "Upgrade Docker Engine to a release that bundles the Compose plugin." >&2
    exit 1
  fi
}

show_version() {
  if [ -f "VERSION" ]; then
    echo "Bundle version:   $(cat VERSION)"
  else
    echo "Bundle version:   unknown (no VERSION file in $(pwd))"
  fi

  require_docker
  if ! docker compose ps --status=running --services 2>/dev/null | grep -q '^web$'; then
    echo "App version:      not running — start the stack with ./start.sh"
    echo "Licence tier:     unknown (containers not running)"
    return 0
  fi

  # The release-please manifest is baked into the web image at build time and
  # contains the published web app version. This is the source of truth for
  # which release of CT-Ops is actually executing right now.
  APP_VERSION=$(docker compose exec -T web sh -c 'cat /app/.release-please-manifest.json 2>/dev/null' \
    | sed -n 's/.*"apps\/web"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
  echo "App version:      ${APP_VERSION:-unknown}"

  # Tier lives on the organisations row — query the DB directly so the licence
  # status is accurate even if no user is logged in. Multiple orgs are unusual
  # on a single-host install but possible; show all of them.
  : "${POSTGRES_USER:=ctops}"
  : "${POSTGRES_DB:=ctops}"
  TIERS=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At \
    -c "SELECT name || ': ' || licence_tier FROM organisations WHERE deleted_at IS NULL ORDER BY created_at;" 2>/dev/null || true)
  if [ -z "$TIERS" ]; then
    echo "Licence tier:     unknown (no organisation configured yet)"
  else
    echo "Licence tier:"
    printf '  %s\n' $TIERS
  fi
}

check_env() {
  if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
      cp .env.example .env
      chmod 600 .env
      echo ""
      echo "Created .env from .env.example."
      echo "Edit .env to set your URLs, then re-run ./start.sh."
      echo ""
      exit 0
    fi
    echo "ERROR: no .env and no .env.example found in $(pwd)" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1091
  source .env
  set +a

  # Auto-generate BETTER_AUTH_SECRET on first run if the operator left it blank.
  # Anyone with this value can forge sessions, so it must never be empty in
  # production — generating it here means the first ./start.sh "just works".
  if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
      echo "ERROR: 'openssl' is required to generate BETTER_AUTH_SECRET on first run." >&2
      exit 1
    fi
    GENERATED_SECRET=$(openssl rand -hex 32)
    if grep -q '^BETTER_AUTH_SECRET=' .env; then
      awk -v s="$GENERATED_SECRET" '/^BETTER_AUTH_SECRET=/ {print "BETTER_AUTH_SECRET=" s; next} {print}' .env > .env.tmp && mv .env.tmp .env
    else
      echo "BETTER_AUTH_SECRET=$GENERATED_SECRET" >> .env
    fi
    chmod 600 .env
    export BETTER_AUTH_SECRET="$GENERATED_SECRET"
    echo "Generated BETTER_AUTH_SECRET and wrote it to .env."
  fi

  # Same reasoning for the database password — the example file ships blank so
  # we never accidentally seed a known credential into a real deployment.
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
      echo "ERROR: 'openssl' is required to generate POSTGRES_PASSWORD on first run." >&2
      exit 1
    fi
    GENERATED_PG_PASS=$(openssl rand -hex 16)
    if grep -q '^POSTGRES_PASSWORD=' .env; then
      awk -v p="$GENERATED_PG_PASS" '/^POSTGRES_PASSWORD=/ {print "POSTGRES_PASSWORD=" p; next} {print}' .env > .env.tmp && mv .env.tmp .env
    else
      echo "POSTGRES_PASSWORD=$GENERATED_PG_PASS" >> .env
    fi
    chmod 600 .env
    export POSTGRES_PASSWORD="$GENERATED_PG_PASS"
    echo "Generated POSTGRES_PASSWORD and wrote it to .env."
  fi

  MISSING=()
  for v in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!v:-}" ]; then
      MISSING+=("$v")
    fi
  done
  if [ ${#MISSING[@]} -gt 0 ]; then
    echo "ERROR: required variables are not set in .env:" >&2
    for v in "${MISSING[@]}"; do echo "  - $v" >&2; done
    echo "" >&2
    echo "Edit .env, then re-run ./start.sh. See ${DOCS_URL} for what each value means." >&2
    exit 1
  fi

  for v in "${OPTIONAL_VARS[@]}"; do
    if [ -z "${!v:-}" ]; then
      echo "WARN: optional variable '$v' is not set — using built-in default."
    fi
  done
}

ensure_tls_certs() {
  CERT_DIR="$SCRIPT_DIR/deploy/dev-tls"
  if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: 'openssl' is required to generate the ingest TLS certificate." >&2
    exit 1
  fi
  echo "Generating ingest TLS certificate (dev-grade, 365-day expiry)..."
  mkdir -p "$CERT_DIR"

  if command -v ip >/dev/null 2>&1; then
    LOCAL_IPS=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print "IP:" a[1]}' | tr '\n' ',' | sed 's/,$//')
  else
    LOCAL_IPS=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print "IP:" $2}' | tr '\n' ',' | sed 's/,$//')
  fi
  SAN="DNS:ingest,DNS:localhost,IP:127.0.0.1"
  [ -n "$LOCAL_IPS" ] && SAN="${SAN},${LOCAL_IPS}"

  openssl req -x509 -newkey rsa:4096 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -sha256 -days 365 -nodes \
    -subj "/CN=ct-ops-ingest" \
    -addext "subjectAltName=${SAN}" 2>/dev/null
  echo "TLS certificate written to ${CERT_DIR} (SANs: ${SAN})."
}

start_stack() {
  require_docker
  check_env
  ensure_tls_certs

  echo "Pulling latest images from GHCR..."
  if ! docker compose pull db web ingest; then
    echo "" >&2
    echo "ERROR: failed to pull one or more images from GHCR." >&2
    echo "  - Check your network access to ghcr.io" >&2
    echo "  - If you pinned WEB_IMAGE/INGEST_IMAGE in .env, verify the tag exists" >&2
    echo "  - For air-gapped installs, load images with: docker load < ct-ops.tar.gz" >&2
    exit 1
  fi

  docker compose down --remove-orphans >/dev/null 2>&1 || true

  echo "Starting CT-Ops..."
  if ! docker compose up -d; then
    echo "" >&2
    echo "ERROR: 'docker compose up' failed." >&2
    echo "Recent logs (last 50 lines per service):" >&2
    docker compose logs --tail 50 || true
    echo "" >&2
    echo "Common causes:" >&2
    echo "  - Ports 3000, 8080, 9443 or 5432 already in use on this host" >&2
    echo "  - Insufficient disk space for the database volume" >&2
    echo "  - .env values that the web/ingest containers reject (check logs above)" >&2
    echo "" >&2
    echo "For more help, see ${DOCS_URL} or open a ticket at ${SUPPORT_URL}" >&2
    exit 1
  fi

  echo ""
  echo "CT-Ops is starting. Open ${BETTER_AUTH_URL:-http://localhost:3000} in your browser."
  echo "Tail logs with:  ./start.sh --logs"
  echo "Stop with:       ./start.sh --down"
}

stop_stack() {
  require_docker
  echo "Stopping CT-Ops..."
  docker compose down
  echo "Stopped. Data volumes are preserved — re-run ./start.sh to bring everything back up."
}

tail_logs() {
  require_docker
  exec docker compose logs -f --tail 100
}

# ---- Argument dispatch ----
if [ "$#" -eq 0 ]; then
  start_stack
  exit 0
fi

if [ "$#" -gt 1 ]; then
  echo "ERROR: only one option may be passed at a time." >&2
  show_help >&2
  exit 1
fi

case "$1" in
  --logs)            tail_logs ;;
  --down)            stop_stack ;;
  --version|-v)      show_version ;;
  --help|-h)         show_help ;;
  *)
    echo "ERROR: unknown option '$1'" >&2
    echo "" >&2
    show_help >&2
    exit 1
    ;;
esac
