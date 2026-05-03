#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT-Ops — Backup Script
#
# Creates a customer-runnable backup archive of the local bundle configuration
# and, when the database container is reachable, a PostgreSQL dump. upgrade.sh
# calls this before replacing release files; operators can also schedule it
# directly.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PRINT_PATH_ONLY=false

show_help() {
  cat <<EOF
CT-Ops — backup helper

Usage:
  ./backup.sh

Environment:
  CT_OPS_BACKUP_DIR=/path/to/backups  Override backup output directory

The archive includes this install directory, including .env, TLS material and
licence-keys/current.pem. If the db container is running, it also includes a
PostgreSQL dump. The archive contains secrets; store it securely.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-path-only)
      PRINT_PATH_ONLY=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "ERROR: unknown option '$1'." >&2
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
    exit 1
  fi
}

read_env_value() {
  local key="$1" fallback="$2" value
  value="$(sed -n "s/^${key}=//p" .env | head -n1 || true)"
  if [ -n "$value" ]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

make_backup() {
  need tar
  need date

  local parent dirname timestamp version safe_version backup_root backup_file
  local staging_name postgres_user postgres_db
  parent="$(dirname "$SCRIPT_DIR")"
  dirname="$(basename "$SCRIPT_DIR")"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  version="$(cat VERSION 2>/dev/null || echo unknown)"
  safe_version="$(printf '%s' "$version" | tr -c 'A-Za-z0-9._-' '_')"

  backup_root="${CT_OPS_BACKUP_DIR:-${parent}/ct-ops-backups}"
  mkdir -p "$backup_root"
  chmod 700 "$backup_root" 2>/dev/null || true

  STAGING_DIR="$(mktemp -d -t ct-ops-backup.XXXXXX)"
  staging_name="${dirname}-${safe_version}-${timestamp}"
  backup_file="${backup_root}/${staging_name}.tar.gz"
  trap 'rm -rf "${STAGING_DIR:-}"' EXIT

  mkdir -p "${STAGING_DIR}/${staging_name}"
  (
    cd "$parent"
    tar -cf - \
      --exclude "${dirname}/ct-ops-support-data-*.tar.gz" \
      --exclude "${dirname}/ct-ops-single-*-airgap.zip" \
      --exclude "${dirname}/images.tar.gz" \
      "$dirname" | (cd "${STAGING_DIR}/${staging_name}" && tar -xf -)
  )

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    if docker compose ps --status=running --services 2>/dev/null | grep -q '^db$'; then
      postgres_user="$(read_env_value POSTGRES_USER ctops)"
      postgres_db="$(read_env_value POSTGRES_DB ctops)"
      if docker compose exec -T db pg_dump -U "$postgres_user" -d "$postgres_db" \
        > "${STAGING_DIR}/${staging_name}/postgres.sql" 2>/dev/null; then
        :
      else
        echo "WARN: database dump failed; install files were still backed up." >&2
        rm -f "${STAGING_DIR}/${staging_name}/postgres.sql"
      fi
    else
      echo "WARN: db container is not running; backup will not include a database dump." >&2
    fi
  else
    echo "WARN: docker compose is not available; backup will not include a database dump." >&2
  fi

  (cd "$STAGING_DIR" && tar -czf "$backup_file" "$staging_name")
  chmod 600 "$backup_file" 2>/dev/null || true

  if $PRINT_PATH_ONLY; then
    printf '%s\n' "$backup_file"
  else
    echo "Backup written to:"
    echo "  $backup_file"
  fi
}

require_existing_bundle
make_backup
