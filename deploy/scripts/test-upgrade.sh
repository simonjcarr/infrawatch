#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
UPGRADE_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/upgrade.sh"
BACKUP_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/backup.sh"

assert_env_value() {
  local env_file="$1"
  local key="$2"
  local expected="$3"
  local actual

  actual="$(sed -n "s/^${key}=//p" "$env_file" | head -n1)"
  if [ "$actual" != "$expected" ]; then
    echo "expected ${key}=${expected}, got ${actual:-<missing>}" >&2
    sed -n '1,200p' "$env_file" >&2
    exit 1
  fi
}

read_env_value() {
  local env_file="$1"
  local key="$2"

  sed -n "s/^${key}=//p" "$env_file" | head -n1
}

make_mock_bin() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi

if [ "$#" -ge 3 ] && [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  exit 0
fi

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "down" ]; then
  printf 'docker compose down %s\n' "${*:3}" >> "${MOCK_DOCKER_LOG}"
  exit 0
fi

exit 0
EOF

  cat > "${dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

if [[ -z "$out" || -z "$url" ]]; then
  echo "mock curl expected -o <file> <url>" >&2
  exit 2
fi

if [[ -n "${MOCK_CURL_LOG:-}" ]]; then
  printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
fi

if [[ "$url" == "https://api.github.com/repos/carrtech-dev/ct-ops/releases?per_page=100" \
  || "$url" == "https://api.github.com/repos/carrtech-dev/ct-ops/releases?per_page=100&page=1" ]]; then
  printf '%s' "${MOCK_RELEASES_JSON}" > "$out"
elif [[ "$url" == "https://api.github.com/repos/carrtech-dev/ct-ops/releases?per_page=100&page=2" ]]; then
  printf '%s' "${MOCK_RELEASES_JSON_PAGE_2:-[]}" > "$out"
elif [[ "$url" == https://api.github.com/repos/carrtech-dev/ct-ops/releases?per_page=100\&page=* ]]; then
  printf '[]' > "$out"
elif [[ "$url" == *.sha256 ]]; then
  printf '%s  ct-ops-single.zip\n' "${MOCK_CHECKSUM}" > "$out"
else
  cp "${MOCK_BUNDLE_ZIP}" "$out"
fi
EOF

  chmod +x "${dir}/docker" "${dir}/curl"
}

write_bundle() {
  local dir="$1"
  local version="$2"

  mkdir -p "${dir}/ct-ops/deploy/nginx" "${dir}/ct-ops/licence-keys"
  printf 'services:\n  web:\n    image: example/web:%s\n' "$version" > "${dir}/ct-ops/docker-compose.yml"
  {
    printf 'BETTER_AUTH_URL=https://example.test\n'
    printf 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:%064d\n' "${version//[^0-9]/}"
    printf 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:%064d\n' "${version//[^0-9]/}"
    printf 'PASSWORD_MANAGER_API_IMAGE=ghcr.io/carrtech-dev/ct-password-manager/api@sha256:%064d\n' "${version//[^0-9]/}"
  } > "${dir}/ct-ops/.env.example"
  cat > "${dir}/ct-ops/password-manager-release.json" <<EOF
{"schema_version":1,"repository":"carrtech-dev/ct-password-manager","git_tag":"api/${version}","source_commit_sha":"53ecd8f3cacbb8617cc05f4847ad506b1988fd99","image_repository":"ghcr.io/carrtech-dev/ct-password-manager/api","image_digest":"sha256:$(printf '%064d' "${version//[^0-9]/}")","digest_reference":"ghcr.io/carrtech-dev/ct-password-manager/api@sha256:$(printf '%064d' "${version//[^0-9]/}")","api_contract_version":"1.0.0","api_contract_checksum_sha256":"a07ffa6c4c8a6f0b57611a1a7c380a8b8ea1a889f4449c4f2ce02f914c05cf95"}
EOF
  printf '# README %s\n' "$version" > "${dir}/ct-ops/README.md"
  printf '#!/usr/bin/env bash\necho start %s\n' "$version" > "${dir}/ct-ops/start.sh"
  cp "$BACKUP_SCRIPT" "${dir}/ct-ops/backup.sh"
  printf '#!/usr/bin/env bash\necho offline %s\n' "$version" > "${dir}/ct-ops/build-offline-installer.sh"
  printf '#!/usr/bin/env bash\necho refresh-key %s\n' "$version" > "${dir}/ct-ops/refresh_licence_key"
  printf '#!/usr/bin/env bash\necho support %s\n' "$version" > "${dir}/ct-ops/generate_support_data"
  cp "$UPGRADE_SCRIPT" "${dir}/ct-ops/upgrade.sh"
  printf '%s\n' "$version" > "${dir}/ct-ops/VERSION"
  printf 'nginx %s\n' "$version" > "${dir}/ct-ops/deploy/nginx/nginx.conf"
  printf 'public-key-%s\n' "$version" > "${dir}/ct-ops/licence-keys/current.pem"
  chmod +x "${dir}/ct-ops/start.sh" \
    "${dir}/ct-ops/backup.sh" \
    "${dir}/ct-ops/build-offline-installer.sh" \
    "${dir}/ct-ops/refresh_licence_key" \
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
    printf 'PASSWORD_MANAGER_API_IMAGE=ghcr.io/carrtech-dev/ct-password-manager/api@sha256:%064d\n' 100
  } > "${old_install}/.env"
  mkdir -p "${old_install}/deploy/tls" "${old_install}/deploy/dev-tls"
  printf 'tls-cert\n' > "${old_install}/deploy/tls/server.crt"
  printf 'dev-cert\n' > "${old_install}/deploy/dev-tls/server.crt"
  printf 'stale image archive\n' > "${old_install}/images.tar.gz"
  rm -f "${old_install}/licence-keys/current.pem"
  chmod 500 "${old_install}/licence-keys"

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
  assert_env_value "${old_install}/.env" PASSWORD_MANAGER_API_IMAGE "$(read_env_value "${new_src}/ct-ops/.env.example" PASSWORD_MANAGER_API_IMAGE)"
  grep -q '"git_tag":"api/v9.9.9"' "${old_install}/password-manager-release.json"
  grep -q 'tls-cert' "${old_install}/deploy/tls/server.crt"
  grep -q 'dev-cert' "${old_install}/deploy/dev-tls/server.crt"
  grep -q 'public-key-v9.9.9' "${old_install}/licence-keys/current.pem"
  test -w "${old_install}/licence-keys"
  test ! -f "${old_install}/images.tar.gz"
  grep -q 'docker compose down' "$docker_log"

  local backups
  backups="$(find "$backup_dir" -name '*.tar.gz' -type f | wc -l | tr -d ' ')"
  if [ "$backups" != "1" ]; then
    echo "expected one backup tarball, found $backups" >&2
    exit 1
  fi

  rm -rf "$old_install" "$new_src" "$backup_dir"
  mkdir -p "${tmpdir}/current" "$backup_dir"

  write_bundle "${tmpdir}/current" "v1.0.0"
  rm -f "${old_install}/backup.sh"
  {
    printf 'customer-secret=true\n'
    printf 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:%064d\n' 100
    printf 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:%064d\n' 100
    printf 'PASSWORD_MANAGER_API_IMAGE=ghcr.io/carrtech-dev/ct-password-manager/api@sha256:%064d\n' 100
  } > "${old_install}/.env"

  write_bundle "$new_src" "v9.9.9"
  rm -f "$bundle_zip"
  (cd "$new_src" && zip -qr "$bundle_zip" ct-ops)

  (
    cd "$old_install"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" \
      MOCK_DOCKER_LOG="$docker_log" \
      CT_OPS_BACKUP_DIR="$backup_dir" \
      ./upgrade.sh --from-zip "$bundle_zip" --no-start
  )

  test -x "${old_install}/backup.sh"
  grep -q 'example/web:v9.9.9' "${old_install}/docker-compose.yml"
  grep -q '"git_tag":"api/v9.9.9"' "${old_install}/password-manager-release.json"
  grep -q 'public-key-v9.9.9' "${old_install}/licence-keys/current.pem"

  backups="$(find "$backup_dir" -name '*.tar.gz' -type f | wc -l | tr -d ' ')"
  if [ "$backups" != "1" ]; then
    echo "expected one backup tarball for legacy install, found $backups" >&2
    exit 1
  fi

  rm -rf "$old_install" "$new_src" "$backup_dir"
  mkdir -p "${tmpdir}/current" "$backup_dir"

  write_bundle "${tmpdir}/current" "v1.0.0"
  {
    printf 'customer-secret=true\n'
    printf 'WEB_IMAGE=ghcr.io/carrtech-dev/ct-ops/web@sha256:%064d\n' 100
    printf 'INGEST_IMAGE=ghcr.io/carrtech-dev/ct-ops/ingest@sha256:%064d\n' 100
    printf 'PASSWORD_MANAGER_API_IMAGE=ghcr.io/carrtech-dev/ct-password-manager/api@sha256:%064d\n' 100
  } > "${old_install}/.env"

  write_bundle "$new_src" "v0.100.0"
  rm -f "$bundle_zip"
  (cd "$new_src" && zip -qr "$bundle_zip" ct-ops)

  export MOCK_RELEASES_JSON='[
    { "tag_name": "ingest/v9.9.9" },
    { "tag_name": "web/v0.99.0" },
    { "tag_name": "web/v0.98.0" }
  ]'
  export MOCK_RELEASES_JSON_PAGE_2='[
    { "tag_name": "web/v0.100.0" }
  ]'
  export MOCK_BUNDLE_ZIP="$bundle_zip"
  export MOCK_CURL_LOG="${tmpdir}/curl.log"
  export MOCK_CHECKSUM
  MOCK_CHECKSUM="$(openssl dgst -sha256 "$bundle_zip" | awk '{print $NF}')"

  (
    cd "$old_install"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" \
      MOCK_DOCKER_LOG="$docker_log" \
      CT_OPS_BACKUP_DIR="$backup_dir" \
      ./upgrade.sh --no-start
  )

  grep -Fxq "https://github.com/carrtech-dev/ct-ops/releases/download/web/v0.100.0/ct-ops-single.zip" "$MOCK_CURL_LOG"
  grep -Fxq "https://github.com/carrtech-dev/ct-ops/releases/download/web/v0.100.0/ct-ops-single.zip.sha256" "$MOCK_CURL_LOG"
  grep -q 'example/web:v0.100.0' "${old_install}/docker-compose.yml"
  assert_env_value "${old_install}/.env" PASSWORD_MANAGER_API_IMAGE "$(read_env_value "${new_src}/ct-ops/.env.example" PASSWORD_MANAGER_API_IMAGE)"
  grep -q '"git_tag":"api/v0.100.0"' "${old_install}/password-manager-release.json"
  unset MOCK_CURL_LOG MOCK_RELEASES_JSON_PAGE_2

  echo "upgrade.sh local bundle tests passed"
}

main "$@"
