#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
UPGRADE_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/upgrade.sh"

make_mock_bin() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "down" ]; then
  printf 'docker compose down %s\n' "${*:3}" >> "${MOCK_DOCKER_LOG}"
  exit 0
fi

exit 0
EOF

  chmod +x "${dir}/docker"
}

write_bundle() {
  local dir="$1"
  local version="$2"

  mkdir -p "${dir}/ct-ops/deploy/nginx"
  printf 'services:\n  web:\n    image: example/web:%s\n' "$version" > "${dir}/ct-ops/docker-compose.yml"
  {
    printf 'BETTER_AUTH_URL=https://example.test\n'
    printf 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:%064d\n' "${version//[^0-9]/}"
    printf 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:%064d\n' "${version//[^0-9]/}"
  } > "${dir}/ct-ops/.env.example"
  printf '# README %s\n' "$version" > "${dir}/ct-ops/README.md"
  printf '#!/usr/bin/env bash\necho start %s\n' "$version" > "${dir}/ct-ops/start.sh"
  printf '#!/usr/bin/env bash\necho offline %s\n' "$version" > "${dir}/ct-ops/build-offline-installer.sh"
  printf '#!/usr/bin/env bash\necho support %s\n' "$version" > "${dir}/ct-ops/generate_support_data"
  cp "$UPGRADE_SCRIPT" "${dir}/ct-ops/upgrade.sh"
  printf '%s\n' "$version" > "${dir}/ct-ops/VERSION"
  printf 'nginx %s\n' "$version" > "${dir}/ct-ops/deploy/nginx/nginx.conf"
  chmod +x "${dir}/ct-ops/start.sh" \
    "${dir}/ct-ops/build-offline-installer.sh" \
    "${dir}/ct-ops/generate_support_data" \
    "${dir}/ct-ops/upgrade.sh"
}

main() {
  local tmpdir mockbin old_install new_src backup_dir bundle_zip docker_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  mockbin="${tmpdir}/mockbin"
  old_install="${tmpdir}/current/ct-ops"
  new_src="${tmpdir}/new"
  backup_dir="${tmpdir}/backups"
  bundle_zip="${tmpdir}/ct-ops-single-v9.9.9.zip"
  docker_log="${tmpdir}/docker.log"
  mkdir -p "$mockbin" "${tmpdir}/current" "$backup_dir"
  make_mock_bin "$mockbin"

  write_bundle "${tmpdir}/current" "v1.0.0"
  {
    printf 'customer-secret=true\n'
    printf 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:%064d\n' 100
    printf 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:%064d\n' 100
  } > "${old_install}/.env"
  mkdir -p "${old_install}/deploy/tls" "${old_install}/deploy/dev-tls"
  printf 'tls-cert\n' > "${old_install}/deploy/tls/server.crt"
  printf 'dev-cert\n' > "${old_install}/deploy/dev-tls/server.crt"
  printf 'stale image archive\n' > "${old_install}/images.tar.gz"

  write_bundle "$new_src" "v9.9.9"
  (cd "$new_src" && zip -qr "$bundle_zip" ct-ops)

  (
    cd "$old_install"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" \
      MOCK_DOCKER_LOG="$docker_log" \
      CT_OPS_BACKUP_DIR="$backup_dir" \
      ./upgrade.sh --from-zip "$bundle_zip" --no-start
  )

  grep -q 'example/web:v9.9.9' "${old_install}/docker-compose.yml"
  grep -q 'customer-secret=true' "${old_install}/.env"
  grep -q 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:.*999' "${old_install}/.env"
  grep -q 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:.*999' "${old_install}/.env"
  grep -q 'tls-cert' "${old_install}/deploy/tls/server.crt"
  grep -q 'dev-cert' "${old_install}/deploy/dev-tls/server.crt"
  test ! -f "${old_install}/images.tar.gz"
  grep -q 'docker compose down' "$docker_log"

  local backups
  backups="$(find "$backup_dir" -name '*.tar.gz' -type f | wc -l | tr -d ' ')"
  if [ "$backups" != "1" ]; then
    echo "expected one backup tarball, found $backups" >&2
    exit 1
  fi

  echo "upgrade.sh local bundle tests passed"
}

main "$@"
