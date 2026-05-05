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
#   ./upgrade.sh           Back up this install and upgrade to a new release
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
OPTIONAL_VARS=(AGENT_DOWNLOAD_BASE_URL INGEST_WS_URL CT_OPS_TRUST_PROXY_HEADERS CT_OPS_LOADTEST_ADMIN_KEY WEB_IMAGE INGEST_IMAGE PASSWORD_MANAGER_API_IMAGE PASSWORD_MANAGER_DB_PASSWORD PASSWORD_MANAGER_CT_OPS_ISSUER PASSWORD_MANAGER_CT_OPS_AUDIENCE PASSWORD_MANAGER_CT_OPS_PRODUCT PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY PASSWORD_MANAGER_TRUSTED_ORIGINS PASSWORD_MANAGER_SESSION_COOKIE_SECURE CT_OPS_INSTANCE_ID)
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
  ./upgrade.sh            Back up this install and upgrade to a new release
  ./generate_support_data  Create a redacted support archive for tickets

Documentation: ${DOCS_URL}
Support:       ${SUPPORT_URL}
EOF
}

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

require_openssl() {
  local purpose="$1"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: 'openssl' is required to ${purpose}." >&2
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
      echo "ERROR: failed to encode Password Manager launch-signing private key." >&2
      exit 1
    fi
    if ! openssl pkey -in "$private_pem" -pubout -outform DER -out "$public_der" >/dev/null 2>&1; then
      rm -rf "$tmpdir"
      echo "ERROR: failed to derive Password Manager launch-signing public key." >&2
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
    encoding=serialization.Encoding.DER,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
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
process.stdout.write(publicKey.export({ format: 'der', type: 'spki' }).toString('base64') + '\n')
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

ensure_password_manager_bootstrap() {
  local issuer trusted_origins cookie_secure instance_id generated_private_key generated_public_key keypair_output

  if [ -z "${PASSWORD_MANAGER_DB_PASSWORD:-}" ]; then
    require_openssl "generate PASSWORD_MANAGER_DB_PASSWORD on first run"
    upsert_env_var "PASSWORD_MANAGER_DB_PASSWORD" "$(openssl rand -hex 16)"
    echo "Generated PASSWORD_MANAGER_DB_PASSWORD and wrote it to .env."
  fi

  if [ -z "${CT_OPS_INSTANCE_ID:-}" ]; then
    require_openssl "generate CT_OPS_INSTANCE_ID on first run"
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
    require_openssl "generate BETTER_AUTH_SECRET on first run"
    GENERATED_SECRET=$(openssl rand -hex 32)
    upsert_env_var "BETTER_AUTH_SECRET" "$GENERATED_SECRET"
    echo "Generated BETTER_AUTH_SECRET and wrote it to .env."
  fi

  # Same reasoning for the database password — the example file ships blank so
  # we never accidentally seed a known credential into a real deployment.
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    require_openssl "generate POSTGRES_PASSWORD on first run"
    GENERATED_PG_PASS=$(openssl rand -hex 16)
    upsert_env_var "POSTGRES_PASSWORD" "$GENERATED_PG_PASS"
    echo "Generated POSTGRES_PASSWORD and wrote it to .env."
  fi

  ensure_password_manager_bootstrap

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
  if ! mkdir -p "$out_dir"; then
    echo "ERROR: could not create TLS directory: $out_dir" >&2
    exit 1
  fi
  if [ ! -w "$out_dir" ]; then
    echo "ERROR: TLS directory is not writable: $out_dir" >&2
    echo "Fix ownership or permissions, for example:" >&2
    echo "  sudo chown -R $(id -u):$(id -g) $out_dir" >&2
    exit 1
  fi

  local local_ips=""
  if command -v ip >/dev/null 2>&1; then
    local_ips=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print "IP:" a[1]}' | tr '\n' ',' | sed 's/,$//' || true)
  elif command -v ifconfig >/dev/null 2>&1; then
    local_ips=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print "IP:" $2}' | tr '\n' ',' | sed 's/,$//' || true)
  fi
  local san="DNS:ingest,DNS:localhost,IP:127.0.0.1"
  [ -n "$local_ips" ] && san="${san},${local_ips}"

  local openssl_err
  openssl_err="$(mktemp -t ct-ops-openssl.XXXXXX)"
  if ! openssl req -x509 -newkey rsa:4096 \
    -keyout "$out_dir/server.key" \
    -out "$out_dir/server.crt" \
    -sha256 -days 365 -nodes \
    -subj "/CN=${cn}" \
    -addext "subjectAltName=${san}" 2>"$openssl_err"; then
    echo "ERROR: failed to generate TLS certificate in $out_dir" >&2
    sed 's/^/  /' "$openssl_err" >&2
    rm -f "$openssl_err"
    exit 1
  fi
  rm -f "$openssl_err"
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
    echo "Pulling release-pinned images from GHCR..."
    if ! docker compose pull db password-manager-db password-manager-migrate password-manager-api web migrate ingest nginx tls-init; then
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
