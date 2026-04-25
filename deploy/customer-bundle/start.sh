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
REQUIRED_FILES=(
  docker-compose.yml
  deploy/nginx/nginx.conf
)

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

check_bundle_files() {
  local missing=()
  local wrong_type=()
  local file

  for file in "${REQUIRED_FILES[@]}"; do
    if [ -d "$file" ]; then
      wrong_type+=("$file is a directory")
    elif [ ! -f "$file" ]; then
      missing+=("$file")
    fi
  done

  if [ ${#missing[@]} -eq 0 ] && [ ${#wrong_type[@]} -eq 0 ]; then
    return 0
  fi

  echo "ERROR: this CT-Ops bundle is incomplete or corrupt." >&2
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Missing required files:" >&2
    for file in "${missing[@]}"; do echo "  - $file"; done >&2
  fi
  if [ ${#wrong_type[@]} -gt 0 ]; then
    echo "Invalid paths:" >&2
    for file in "${wrong_type[@]}"; do echo "  - $file"; done >&2
  fi
  echo "" >&2
  echo "Re-download the release bundle and unpack it into a clean directory." >&2
  exit 1
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

gen_cert() {
  # Run the shared generator inline rather than shelling out to a file that
  # may not be present in every bundle layout. Keeps the customer bundle
  # self-contained.
  #
  # Args: $1 = OUT_DIR, $2 = CN
  local out_dir="$1"
  local cn="$2"

  if [ -f "$out_dir/server.crt" ] && [ -f "$out_dir/server.key" ]; then
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: 'openssl' is required to generate TLS certificates." >&2
    exit 1
  fi
  mkdir -p "$out_dir"

  local local_ips=""
  if command -v ip >/dev/null 2>&1; then
    local_ips=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print "IP:" a[1]}' | tr '\n' ',' | sed 's/,$//' || true)
  elif command -v ifconfig >/dev/null 2>&1; then
    local_ips=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print "IP:" $2}' | tr '\n' ',' | sed 's/,$//' || true)
  fi
  local san="DNS:ingest,DNS:localhost,IP:127.0.0.1"
  [ -n "$local_ips" ] && san="${san},${local_ips}"

  openssl req -x509 -newkey rsa:4096 \
    -keyout "$out_dir/server.key" \
    -out "$out_dir/server.crt" \
    -sha256 -days 365 -nodes \
    -subj "/CN=${cn}" \
    -addext "subjectAltName=${san}" 2>/dev/null
  chmod 600 "$out_dir/server.key"
  chmod 644 "$out_dir/server.crt"
  echo "Wrote ${out_dir}/server.{crt,key} (CN=${cn}, SANs: ${san})"
}

fix_ingest_tls_permissions() {
  local cert_dir="$SCRIPT_DIR/deploy/dev-tls"
  [ -f "$cert_dir/server.key" ] || return 0
  [ -f "$cert_dir/server.crt" ] || return 0

  # The ingest image runs as uid/gid 1001. These files are bind-mounted
  # read-only, so make the key readable before Docker starts the container.
  if chown 1001:1001 "$cert_dir/server.key" "$cert_dir/server.crt" 2>/dev/null; then
    chmod 600 "$cert_dir/server.key"
  else
    chmod 644 "$cert_dir/server.key"
  fi
  chmod 644 "$cert_dir/server.crt"
}

ensure_tls_certs() {
  # Ingest mTLS cert — consumed by the gRPC listener on :9443.
  if [ ! -f "$SCRIPT_DIR/deploy/dev-tls/server.crt" ] || [ ! -f "$SCRIPT_DIR/deploy/dev-tls/server.key" ]; then
    echo "Generating ingest TLS certificate (self-signed, 365-day expiry)..."
    gen_cert "$SCRIPT_DIR/deploy/dev-tls" "ct-ops-ingest"
  fi

  # Browser-facing server cert — consumed by the bundled nginx on :443.
  # If both files exist we skip generation regardless of origin, so operators
  # can pre-seed a real cert into deploy/tls/ before the first install.
  if [ ! -f "$SCRIPT_DIR/deploy/tls/server.crt" ] || [ ! -f "$SCRIPT_DIR/deploy/tls/server.key" ]; then
    echo "Generating nginx TLS certificate (self-signed, 365-day expiry)..."
    gen_cert "$SCRIPT_DIR/deploy/tls" "ct-ops"
    echo "Replace deploy/tls/server.crt and deploy/tls/server.key with your own"
    echo "certificate at any time to remove the browser warning."
  fi

  fix_ingest_tls_permissions
}

# check_ports_free fails fast when :80 or :443 are already bound on the host,
# pointing the operator at the NGINX_HTTPS_PORT / NGINX_HTTP_PORT overrides.
check_ports_free() {
  local https_port="${NGINX_HTTPS_PORT:-443}"
  local http_port="${NGINX_HTTP_PORT:-80}"
  local in_use=()
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${https_port}$" && in_use+=("${https_port}")
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${http_port}$"  && in_use+=("${http_port}")
  fi
  if [ ${#in_use[@]} -gt 0 ]; then
    echo "ERROR: the following ports are already bound on this host: ${in_use[*]}" >&2
    echo "  Either free them or override the nginx ports in .env:" >&2
    echo "    NGINX_HTTPS_PORT=8443" >&2
    echo "    NGINX_HTTP_PORT=8080" >&2
    exit 1
  fi
}

# warn_legacy_env emits a one-line notice for each http://localhost:3000-style
# value carried over from a pre-nginx install. We do not rewrite .env —
# operators who intentionally front CT-Ops with a different reverse proxy
# would lose their config. See docs/getting-started/configuration.md.
warn_legacy_env() {
  local legacy=()
  local var
  for var in BETTER_AUTH_URL BETTER_AUTH_TRUSTED_ORIGINS AGENT_DOWNLOAD_BASE_URL; do
    local val="${!var:-}"
    if [ -n "$val" ] && [ "${val#http://}" != "$val" ]; then
      legacy+=("$var=$val")
    fi
  done
  if [ ${#legacy[@]} -gt 0 ]; then
    echo ""
    echo "NOTICE: .env contains plaintext HTTP values from a previous install:"
    for entry in "${legacy[@]}"; do echo "  - $entry"; done
    echo "The bundled nginx now terminates TLS on https://<host>. Update these"
    echo "values to https:// URLs when you're ready. Not rewriting automatically"
    echo "so operators fronting CT-Ops with a different proxy keep working."
    echo ""
  fi
}

start_stack() {
  check_bundle_files
  require_docker
  check_env
  warn_legacy_env
  check_ports_free
  ensure_tls_certs

  if [ -f "images.tar.gz" ]; then
    echo "Loading bundled Docker images (offline mode)..."
    if ! docker load -i images.tar.gz; then
      echo "ERROR: failed to load images from images.tar.gz" >&2
      echo "  - The archive may be corrupted; rebuild the air-gap bundle" >&2
      echo "  - Verify free disk space with: df -h" >&2
      exit 1
    fi
  else
    echo "Pulling latest images from GHCR..."
    if ! docker compose pull db web migrate ingest nginx tls-init; then
      echo "" >&2
      echo "ERROR: failed to pull one or more images from GHCR." >&2
      echo "  - Check your network access to ghcr.io" >&2
      echo "  - If you pinned WEB_IMAGE/INGEST_IMAGE in .env, verify the tag exists" >&2
      echo "  - For air-gapped installs, run ./build-offline-installer.sh on a" >&2
      echo "    connected host and ship the resulting *-airgap.zip to this host" >&2
      exit 1
    fi
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
  echo "CT-Ops is starting. Open ${BETTER_AUTH_URL:-https://localhost} in your browser."
  echo "Your browser will warn about the self-signed certificate on first visit — accept it"
  echo "or replace deploy/tls/server.{crt,key} with a certificate from your own CA."
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
