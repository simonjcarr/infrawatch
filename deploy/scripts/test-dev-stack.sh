#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

assert_contains() {
  local file="$1"
  local needle="$2"

  if ! grep -Fq "$needle" "$file"; then
    echo "expected ${file} to contain: ${needle}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local needle="$2"

  if grep -Fq "$needle" "$file"; then
    echo "expected ${file} not to contain: ${needle}" >&2
    exit 1
  fi
}

run_config_generation_test() {
  local tmpdir repo_dir before_root_env private_key expected_public actual_public

  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ct-ops-dev-stack-test.XXXXXX")"
  trap 'rm -rf "'"$tmpdir"'"' RETURN

  repo_dir="${tmpdir}/ct-ops"
  mkdir -p "$repo_dir"
  cp -R \
    "${REPO_ROOT}/apps" \
    "${REPO_ROOT}/deploy" \
    "${REPO_ROOT}/dev-stack.sh" \
    "${REPO_ROOT}/docker-compose.dev-stack.yml" \
    "${REPO_ROOT}/package.json" \
    "${REPO_ROOT}/Makefile" \
    "$repo_dir/"
  cp "${REPO_ROOT}/deploy/password-manager-release.json" "$repo_dir/deploy/password-manager-release.json"

  cat > "${repo_dir}/.env" <<'EOF'
BETTER_AUTH_URL=https://test-server.example.com
BETTER_AUTH_SECRET=production-like-secret
POSTGRES_PASSWORD=production-like-postgres
EOF
  before_root_env="$(cat "${repo_dir}/.env")"

  (
    cd "$repo_dir"
    ./dev-stack.sh --write-config-only >/dev/null
  )

  if [ "$(cat "${repo_dir}/.env")" != "$before_root_env" ]; then
    echo "dev-stack.sh must not modify root .env" >&2
    exit 1
  fi

  test -f "${repo_dir}/.dev/dev.env"
  test -f "${repo_dir}/apps/web/.env.local"

  assert_contains "${repo_dir}/.dev/dev.env" "BETTER_AUTH_URL=http://localhost:3000"
  assert_contains "${repo_dir}/.dev/dev.env" "PASSWORD_MANAGER_SESSION_COOKIE_SECURE=false"
  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_TRUST_PROXY_HEADERS=true"
  assert_contains "${repo_dir}/apps/web/.env.local" "BETTER_AUTH_URL=http://localhost:3000"
  assert_contains "${repo_dir}/apps/web/.env.local" "DATABASE_URL=postgresql://"
  assert_contains "${repo_dir}/apps/web/.env.local" "PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY="
  assert_not_contains "${repo_dir}/apps/web/.env.local" "https://test-server.example.com"

  private_key="$(sed -n 's/^PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY=//p' "${repo_dir}/.dev/dev.env")"
  actual_public="$(sed -n 's/^PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY=//p' "${repo_dir}/.dev/dev.env")"
  expected_public="$(
    CT_PM_PRIVATE_KEY="$private_key" node - <<'EOF'
const { createPrivateKey, createPublicKey } = require('node:crypto')
const privateKey = createPrivateKey({
  key: Buffer.from(process.env.CT_PM_PRIVATE_KEY, 'base64'),
  format: 'der',
  type: 'pkcs8',
})
process.stdout.write(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'))
EOF
  )"

  if [ "$actual_public" != "$expected_public" ]; then
    echo "Password Manager public key does not match generated private key" >&2
    exit 1
  fi
}

run_public_config_generation_test() {
  local tmpdir repo_dir

  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ct-ops-dev-stack-public-test.XXXXXX")"
  trap 'rm -rf "'"$tmpdir"'"' RETURN

  repo_dir="${tmpdir}/ct-ops"
  mkdir -p "$repo_dir"
  cp -R \
    "${REPO_ROOT}/apps" \
    "${REPO_ROOT}/deploy" \
    "${REPO_ROOT}/dev-stack.sh" \
    "${REPO_ROOT}/docker-compose.dev-stack.yml" \
    "${REPO_ROOT}/package.json" \
    "${REPO_ROOT}/Makefile" \
    "$repo_dir/"
  cp "${REPO_ROOT}/deploy/password-manager-release.json" "$repo_dir/deploy/password-manager-release.json"

  (
    cd "$repo_dir"
    ./dev-stack.sh --public-host 192.0.2.10 --write-config-only >/dev/null
  )

  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_BIND_ADDR=0.0.0.0"
  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_PUBLIC_HOST=192.0.2.10"
  assert_contains "${repo_dir}/.dev/dev.env" "BETTER_AUTH_URL=http://192.0.2.10:3000"
  assert_contains "${repo_dir}/.dev/dev.env" "AGENT_DOWNLOAD_BASE_URL=http://192.0.2.10:3000"
  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_AGENT_INGEST_ADDRESS=192.0.2.10:9443"
  assert_contains "${repo_dir}/.dev/dev.env" "BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://192.0.2.10:3000"
  assert_contains "${repo_dir}/apps/web/.env.local" "BETTER_AUTH_URL=http://192.0.2.10:3000"

  (
    cd "$repo_dir"
    ./dev-stack.sh --local --write-config-only >/dev/null
  )

  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_BIND_ADDR=127.0.0.1"
  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_PUBLIC_HOST="
  assert_contains "${repo_dir}/.dev/dev.env" "BETTER_AUTH_URL=http://localhost:3000"
  assert_contains "${repo_dir}/.dev/dev.env" "CT_OPS_DEV_AGENT_INGEST_ADDRESS=localhost:9443"
}

run_static_wiring_test() {
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "\${CT_OPS_DEV_BIND_ADDR}:\${CT_OPS_DEV_PROXY_PORT}:80"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "\${CT_OPS_DEV_BIND_ADDR}:\${CT_OPS_DEV_INGEST_HTTP_PORT}:8080"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "\${CT_OPS_DEV_BIND_ADDR}:\${CT_OPS_DEV_INGEST_GRPC_PORT}:9443"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "127.0.0.1:\${POSTGRES_PORT}:5432"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "host.docker.internal:host-gateway"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "CT_OPS_DEV_WEB_UPSTREAM: web-dev:3001"
  assert_contains "${REPO_ROOT}/docker-compose.dev-stack.yml" "CT_OPS_DEV_INGEST_UPSTREAM: ingest-dev:8080"
  assert_contains "${REPO_ROOT}/deploy/nginx/dev-stack.conf.template" "location /password-manager-api/"
  assert_contains "${REPO_ROOT}/deploy/nginx/dev-stack.conf.template" "location /ws/terminal/"
  assert_contains "${REPO_ROOT}/deploy/nginx/dev-stack.conf.template" "proxy_pass http://ct_ops_dev_web"
}

run_config_generation_test
run_public_config_generation_test
run_static_wiring_test

echo "dev-stack tests passed"
