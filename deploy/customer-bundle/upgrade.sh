#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT-Ops — Customer Upgrade Script
#
# Run from inside an existing CT-Ops release bundle. The script backs up the
# current bundle, stops the stack without deleting named volumes, installs a
# newer release bundle in place, restores operator-owned files, and starts the
# upgraded stack.
# =============================================================================

REPO_OWNER="carrtech-dev"
REPO_NAME="ct-ops"
RELEASE_MANIFEST_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/.release-please-manifest.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FROM_ZIP=""
START_AFTER_UPGRADE=true
VERSION_OVERRIDE="${CT_OPS_VERSION:-}"

show_help() {
  cat <<EOF
CT-Ops — upgrade helper

Usage:
  ./upgrade.sh
  ./upgrade.sh --version v0.3.0
  ./upgrade.sh --from-zip /path/to/ct-ops-single-v0.3.0-airgap.zip
  ./upgrade.sh --no-start

By default, the latest release bundle is downloaded from GitHub. For air-gapped
hosts, pass a bundle zip with --from-zip. A backup tarball is written before any
files are replaced.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from-zip)
      FROM_ZIP="${2:-}"
      if [ -z "$FROM_ZIP" ]; then
        echo "ERROR: --from-zip requires a path." >&2
        exit 1
      fi
      shift 2
      ;;
    --version)
      VERSION_OVERRIDE="${2:-}"
      if [ -z "$VERSION_OVERRIDE" ]; then
        echo "ERROR: --version requires a version, for example v0.3.0." >&2
        exit 1
      fi
      shift 2
      ;;
    --no-start)
      START_AFTER_UPGRADE=false
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "ERROR: unknown option '$1'." >&2
      echo "" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found in PATH." >&2
    exit 1
  fi
}

require_existing_bundle() {
  local missing=()
  for file in docker-compose.yml start.sh .env; do
    if [ ! -f "$file" ]; then
      missing+=("$file")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: this does not look like an existing CT-Ops install." >&2
    echo "Missing required files:" >&2
    for file in "${missing[@]}"; do echo "  - $file" >&2; done
    echo "Run upgrade.sh from inside the existing ct-ops directory." >&2
    exit 1
  fi
}

require_docker() {
  need docker
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' plugin not found." >&2
    exit 1
  fi
}

latest_bundle_tag() {
  local manifest_tmp version
  manifest_tmp="$(mktemp -t ct-ops.XXXXXX.release-manifest.json)"
  if ! curl -fsSL -o "$manifest_tmp" "$RELEASE_MANIFEST_URL"; then
    rm -f "$manifest_tmp"
    echo "ERROR: could not download the CT-Ops release manifest." >&2
    echo "Try pinning the current release explicitly:" >&2
    echo "  CT_OPS_VERSION=v0.124.5 ./upgrade.sh" >&2
    return 1
  fi

  version="$(awk -F '"' '$2 == "." { print $4; exit }' "$manifest_tmp")"
  rm -f "$manifest_tmp"

  if [[ ! "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
    echo "ERROR: could not read the latest bundle release from ${RELEASE_MANIFEST_URL}." >&2
    exit 1
  fi

  printf 'bundle/v%s\n' "$version"
}

download_bundle() {
  need curl
  need openssl

  local bundle_tag version url checksum_url checksum_tmp expected actual
  if [ -n "$VERSION_OVERRIDE" ]; then
    bundle_tag="$VERSION_OVERRIDE"
    if [[ "$bundle_tag" != bundle/* ]]; then
      bundle_tag="bundle/$bundle_tag"
    fi
    version="${bundle_tag#bundle/}"
    url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${bundle_tag}/ct-ops-single-${version}.zip"
  else
    bundle_tag="$(latest_bundle_tag)"
    version="${bundle_tag#bundle/}"
    url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${bundle_tag}/ct-ops-single.zip"
  fi
  checksum_url="${url}.sha256"

  BUNDLE_ZIP="$(mktemp -t ct-ops.XXXXXX.zip)"
  checksum_tmp="$(mktemp -t ct-ops.XXXXXX.sha256)"
  TEMP_FILES+=("$BUNDLE_ZIP" "$checksum_tmp")

  echo "Downloading CT-Ops ${version}..."
  curl -fsSL -o "$BUNDLE_ZIP" "$url"
  curl -fsSL -o "$checksum_tmp" "$checksum_url"

  expected="$(awk 'NF { print $1; exit }' "$checksum_tmp" | tr '[:upper:]' '[:lower:]')"
  actual="$(openssl dgst -sha256 "$BUNDLE_ZIP" | awk '{print $NF}' | tr '[:upper:]' '[:lower:]')"
  if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
    echo "ERROR: bundle checksum mismatch." >&2
    echo "Expected: ${expected:-<empty>}" >&2
    echo "Actual:   $actual" >&2
    exit 1
  fi
}

verify_local_bundle_checksum() {
  local checksum_file expected actual
  checksum_file="${FROM_ZIP}.sha256"
  if [ ! -f "$checksum_file" ]; then
    return 0
  fi

  need openssl
  expected="$(awk 'NF { print $1; exit }' "$checksum_file" | tr '[:upper:]' '[:lower:]')"
  actual="$(openssl dgst -sha256 "$FROM_ZIP" | awk '{print $NF}' | tr '[:upper:]' '[:lower:]')"
  if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
    echo "ERROR: local bundle checksum mismatch for $FROM_ZIP." >&2
    echo "Expected: ${expected:-<empty>}" >&2
    echo "Actual:   $actual" >&2
    exit 1
  fi
}

make_backup() {
  if [ ! -x ./backup.sh ]; then
    if [ -x "$NEW_BUNDLE_DIR/backup.sh" ]; then
      echo "Restoring backup helper from the new release bundle..."
      cp "$NEW_BUNDLE_DIR/backup.sh" backup.sh
      chmod +x backup.sh
    else
      echo "ERROR: backup.sh is missing or not executable; refusing to upgrade without a backup." >&2
      exit 1
    fi
  fi
  echo "Backing up current install..."
  BACKUP_FILE="$(./backup.sh --print-path-only)"
  echo "  $BACKUP_FILE"
}

unpack_new_bundle() {
  need unzip

  UNPACK_DIR="$(mktemp -d -t ct-ops-upgrade.XXXXXX)"
  TEMP_DIRS+=("$UNPACK_DIR")

  unzip -q "$BUNDLE_ZIP" -d "$UNPACK_DIR"
  NEW_BUNDLE_DIR="$UNPACK_DIR/ct-ops"
  if [ ! -f "$NEW_BUNDLE_DIR/docker-compose.yml" ] \
    || [ ! -f "$NEW_BUNDLE_DIR/start.sh" ] \
    || [ ! -f "$NEW_BUNDLE_DIR/backup.sh" ]; then
    echo "ERROR: upgrade bundle is missing docker-compose.yml, start.sh or backup.sh." >&2
    exit 1
  fi
}

stop_stack() {
  echo "Stopping CT-Ops stack; named volumes are preserved..."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
}

ensure_licence_key_path_writable() {
  if [ ! -f "$NEW_BUNDLE_DIR/licence-keys/current.pem" ]; then
    return 0
  fi

  mkdir -p licence-keys
  if [ -w licence-keys ] && { [ ! -e licence-keys/current.pem ] || [ -w licence-keys/current.pem ]; }; then
    return 0
  fi

  if [ -O licence-keys ]; then
    chmod u+rwx licence-keys
    if [ -e licence-keys/current.pem ]; then
      chmod u+rw licence-keys/current.pem
    fi
  fi

  if [ -w licence-keys ] && { [ ! -e licence-keys/current.pem ] || [ -w licence-keys/current.pem ]; }; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    echo "Repairing licence key directory ownership..."
    sudo chown -R "$(id -u):$(id -g)" licence-keys
    chmod u+rwx licence-keys
    if [ -e licence-keys/current.pem ]; then
      chmod u+rw licence-keys/current.pem
    fi
    return 0
  fi

  echo "ERROR: licence-keys is not writable, so the upgraded verifier key cannot be installed." >&2
  echo "Fix ownership, then rerun ./upgrade.sh:" >&2
  echo "  sudo chown -R $(id -u):$(id -g) licence-keys" >&2
  exit 1
}

install_new_bundle_files() {
  echo "Installing new release files..."

  cp "$NEW_BUNDLE_DIR/docker-compose.yml" docker-compose.yml
  cp "$NEW_BUNDLE_DIR/.env.example" .env.example
  cp "$NEW_BUNDLE_DIR/README.md" README.md
  if [ -f "$NEW_BUNDLE_DIR/password-manager-release.json" ]; then
    cp "$NEW_BUNDLE_DIR/password-manager-release.json" password-manager-release.json
  fi
  cp "$NEW_BUNDLE_DIR/start.sh" start.sh
  cp "$NEW_BUNDLE_DIR/backup.sh" backup.sh
  cp "$NEW_BUNDLE_DIR/build-offline-installer.sh" build-offline-installer.sh
  cp "$NEW_BUNDLE_DIR/refresh_licence_key" refresh_licence_key
  cp "$NEW_BUNDLE_DIR/generate_support_data" generate_support_data
  if [ -f "$NEW_BUNDLE_DIR/upgrade.sh" ]; then
    cp "$NEW_BUNDLE_DIR/upgrade.sh" upgrade.sh
  fi
  if [ -f "$NEW_BUNDLE_DIR/VERSION" ]; then
    cp "$NEW_BUNDLE_DIR/VERSION" VERSION
  fi

  chmod +x start.sh backup.sh build-offline-installer.sh refresh_licence_key generate_support_data
  if [ -f upgrade.sh ]; then
    chmod +x upgrade.sh
  fi

  mkdir -p deploy/nginx
  cp "$NEW_BUNDLE_DIR/deploy/nginx/nginx.conf" deploy/nginx/nginx.conf
  mkdir -p licence-keys
  if [ -f "$NEW_BUNDLE_DIR/licence-keys/current.pem" ]; then
    cp "$NEW_BUNDLE_DIR/licence-keys/current.pem" licence-keys/current.pem
    chmod 644 licence-keys/current.pem
  fi

  # Preserve operator-owned .env and TLS directories already in this install.
  # For online upgrades, remove any old offline image archive so start.sh pulls
  # the images pinned by the newly installed docker-compose.yml. For air-gapped
  # upgrades, the new archive is copied from the provided bundle.
  rm -f images.tar.gz
  if [ -f "$NEW_BUNDLE_DIR/images.tar.gz" ]; then
    cp "$NEW_BUNDLE_DIR/images.tar.gz" images.tar.gz
  fi
}

refresh_release_image_env_refs() {
  local var image new_value current_value

  for var in WEB_IMAGE INGEST_IMAGE ANSIBLE_API_IMAGE; do
    case "$var" in
      WEB_IMAGE) image="web" ;;
      INGEST_IMAGE) image="ingest" ;;
      ANSIBLE_API_IMAGE) image="ansible-api" ;;
      *) echo "ERROR: unsupported image env var: $var" >&2; exit 1 ;;
    esac
    new_value="$(sed -n "s/^${var}=//p" .env.example | head -n1)"
    if [ -z "$new_value" ] || ! grep -q "^${var}=" .env; then
      continue
    fi

    current_value="$(sed -n "s/^${var}=//p" .env | head -n1)"
    case "$current_value" in
      ghcr.io/carrtech-dev/ct-ops/${image}@sha256:*)
        awk -v key="$var" -v value="$new_value" '
          $0 ~ "^" key "=" { print key "=" value; next }
          { print }
        ' .env > .env.tmp
        mv .env.tmp .env
        chmod 600 .env
        ;;
      *)
        echo "WARN: preserving custom ${var} override in .env." >&2
        echo "      Ensure WEB_IMAGE, INGEST_IMAGE, and ANSIBLE_API_IMAGE come from the same CT-Ops bundle release." >&2
        ;;
    esac
  done
}

remove_legacy_password_manager_api_image_env() {
  if ! grep -q '^PASSWORD_MANAGER_API_IMAGE=' .env 2>/dev/null; then
    return 0
  fi

  echo "WARN: removing legacy PASSWORD_MANAGER_API_IMAGE from .env; the upgraded bundle pins the Password Manager API from password-manager-release.json." >&2
  awk '$0 !~ /^PASSWORD_MANAGER_API_IMAGE=/' .env > .env.tmp
  mv .env.tmp .env
  chmod 600 .env
}

start_stack() {
  if ! $START_AFTER_UPGRADE; then
    echo "Upgrade files installed. Start CT-Ops with ./start.sh when ready."
    return 0
  fi

  echo "Starting upgraded CT-Ops stack..."
  ./start.sh
}

cleanup() {
  local file dir
  for file in "${TEMP_FILES[@]:-}"; do
    rm -f "$file"
  done
  for dir in "${TEMP_DIRS[@]:-}"; do
    rm -rf "$dir"
  done
}

TEMP_FILES=()
TEMP_DIRS=()
BUNDLE_ZIP=""
BACKUP_FILE=""
UNPACK_DIR=""
NEW_BUNDLE_DIR=""
trap cleanup EXIT

require_existing_bundle
require_docker

if [ -n "$FROM_ZIP" ]; then
  if [ ! -f "$FROM_ZIP" ]; then
    echo "ERROR: local bundle not found: $FROM_ZIP" >&2
    exit 1
  fi
  verify_local_bundle_checksum
  BUNDLE_ZIP="$FROM_ZIP"
else
  download_bundle
fi

unpack_new_bundle
make_backup
ensure_licence_key_path_writable
stop_stack
install_new_bundle_files
refresh_release_image_env_refs
remove_legacy_password_manager_api_image_env
start_stack

echo ""
echo "Upgrade complete."
echo "Backup: $BACKUP_FILE"
