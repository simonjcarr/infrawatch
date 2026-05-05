#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT_START_SCRIPT="${REPO_ROOT}/start.sh"
BUNDLE_START_SCRIPT="${REPO_ROOT}/deploy/customer-bundle/start.sh"

make_mock_docker() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 2 ] && [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi

if [ "$#" -ge 1 ] && [ "$1" = "compose" ]; then
  if [ -n "${MOCK_DOCKER_LOG:-}" ]; then
    printf 'docker %s\n' "$*" >> "$MOCK_DOCKER_LOG"
  fi
  exit 0
fi

if [ "$#" -ge 1 ] && [ "$1" = "load" ]; then
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 99
EOF

  chmod +x "${dir}/docker"
}

assert_env_value() {
  local env_file="$1"
  local key="$2"
  local value

  value="$(awk -F= -v key="$key" '$1 == key {print substr($0, length(key) + 2)}' "$env_file" | tail -n1)"
  if [ -z "$value" ]; then
    echo "expected ${key} in ${env_file}" >&2
    sed -n '1,200p' "$env_file" >&2
    exit 1
  fi
  printf '%s' "$value"
}

assert_file_mode_600() {
  local path="$1"
  local mode

  if stat -f '%Lp' "$path" >/dev/null 2>&1; then
    mode="$(stat -f '%Lp' "$path")"
  else
    mode="$(stat -c '%a' "$path")"
  fi

  if [ "$mode" != "600" ]; then
    echo "expected ${path} to have mode 600, got ${mode}" >&2
    exit 1
  fi
}

assert_ed25519_pair_matches() {
  local public_key="$1"
  local private_key="$2"
  local tmpdir private_der public_der public_key_bytes derived_public

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' RETURN
  private_der="${tmpdir}/private.der"
  public_der="${tmpdir}/public.der"
  printf '%s' "$private_key" | openssl base64 -d -A > "$private_der"
  printf '%s' "$public_key" | openssl base64 -d -A > "$public_der"
  public_key_bytes="$(wc -c < "$public_der" | tr -d ' ')"
  if [ "$public_key_bytes" != "32" ]; then
    echo "expected generated public key to decode to 32 raw bytes, got ${public_key_bytes}" >&2
    exit 1
  fi
  derived_public="$(openssl pkey -inform DER -in "$private_der" -pubout -outform DER | tail -c 32 | base64 | tr -d '\n')"

  if [ "$derived_public" != "$public_key" ]; then
    echo "generated public key does not match generated private key" >&2
    exit 1
  fi
}

assert_password_manager_bootstrap() {
  local env_file="$1"
  local expected_issuer="$2"
  local expected_trusted_origins="$3"
  local expected_cookie_secure="$4"
  local db_password instance_id audience product public_key private_key

  db_password="$(assert_env_value "$env_file" PASSWORD_MANAGER_DB_PASSWORD)"
  instance_id="$(assert_env_value "$env_file" CT_OPS_INSTANCE_ID)"
  audience="$(assert_env_value "$env_file" PASSWORD_MANAGER_CT_OPS_AUDIENCE)"
  product="$(assert_env_value "$env_file" PASSWORD_MANAGER_CT_OPS_PRODUCT)"
  public_key="$(assert_env_value "$env_file" PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY)"
  private_key="$(assert_env_value "$env_file" PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY)"

  [ "$db_password" != "test-postgres-password" ]
  [ "$instance_id" != "ct-ops-dev" ]
  [ "$audience" = "ct-password-manager" ]
  [ "$product" = "ct-password-manager" ]
  [ "$(assert_env_value "$env_file" PASSWORD_MANAGER_CT_OPS_ISSUER)" = "$expected_issuer" ]
  [ "$(assert_env_value "$env_file" PASSWORD_MANAGER_TRUSTED_ORIGINS)" = "$expected_trusted_origins" ]
  [ "$(assert_env_value "$env_file" PASSWORD_MANAGER_SESSION_COOKIE_SECURE)" = "$expected_cookie_secure" ]

  case "$instance_id" in
    ct-ops-*) ;;
    *)
      echo "expected generated CT_OPS_INSTANCE_ID to start with ct-ops-, got ${instance_id}" >&2
      exit 1
      ;;
  esac

  assert_ed25519_pair_matches "$public_key" "$private_key"
  assert_file_mode_600 "$env_file"
}

run_root_start_bootstrap_test() {
  local tmpdir mockbin repo_dir docker_log

  tmpdir="$(mktemp -d)"
  trap 'chmod -R u+w "'"$tmpdir"'" 2>/dev/null || true; rm -rf "'"$tmpdir"'"' RETURN
  mockbin="${tmpdir}/mockbin"
  repo_dir="${tmpdir}/ct-ops"
  docker_log="${tmpdir}/docker.log"
  mkdir -p "$mockbin" "$repo_dir/deploy/dev-tls"
  make_mock_docker "$mockbin"

  cp "$ROOT_START_SCRIPT" "$repo_dir/start.sh"
  cat > "$repo_dir/.env" <<'EOF'
BETTER_AUTH_URL=https://ct-ops.example.test
BETTER_AUTH_TRUSTED_ORIGINS=https://ct-ops.example.test,https://ops-alt.example.test
BETTER_AUTH_SECRET=test-auth-secret
POSTGRES_PASSWORD=test-postgres-password
PASSWORD_MANAGER_DB_PASSWORD=
CT_OPS_INSTANCE_ID=
PASSWORD_MANAGER_CT_OPS_ISSUER=
PASSWORD_MANAGER_CT_OPS_AUDIENCE=
PASSWORD_MANAGER_CT_OPS_PRODUCT=
PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY=
PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY=
PASSWORD_MANAGER_TRUSTED_ORIGINS=
PASSWORD_MANAGER_SESSION_COOKIE_SECURE=
EOF

  (
    cd "$repo_dir" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" MOCK_DOCKER_LOG="$docker_log" ./start.sh >/dev/null 2>&1
  )

  grep -q 'docker compose -f docker-compose.single.yml up --force-recreate --abort-on-container-exit --exit-code-from migrate migrate' "$docker_log"
  grep -q 'docker compose -f docker-compose.single.yml up --force-recreate --abort-on-container-exit --exit-code-from password-manager-migrate password-manager-migrate' "$docker_log"

  assert_password_manager_bootstrap \
    "$repo_dir/.env" \
    "https://ct-ops.example.test" \
    "https://ct-ops.example.test,https://ops-alt.example.test" \
    "true"
}

run_bundle_start_bootstrap_test() {
  local tmpdir mockbin bundle_dir docker_log

  tmpdir="$(mktemp -d)"
  trap 'chmod -R u+w "'"$tmpdir"'" 2>/dev/null || true; rm -rf "'"$tmpdir"'"' RETURN
  mockbin="${tmpdir}/mockbin"
  bundle_dir="${tmpdir}/bundle"
  docker_log="${tmpdir}/docker.log"
  mkdir -p "$mockbin" "$bundle_dir/deploy/nginx" "$bundle_dir/deploy/dev-tls" "$bundle_dir/deploy/tls"
  make_mock_docker "$mockbin"

  cp "$BUNDLE_START_SCRIPT" "$bundle_dir/start.sh"
  printf 'services: {}\n' > "$bundle_dir/docker-compose.yml"
  printf 'events {}\nhttp { server { listen 443 ssl; } }\n' > "$bundle_dir/deploy/nginx/nginx.conf"
  cat > "$bundle_dir/.env" <<'EOF'
BETTER_AUTH_URL=http://ct-ops.example.test
BETTER_AUTH_TRUSTED_ORIGINS=http://ct-ops.example.test
BETTER_AUTH_SECRET=test-auth-secret
POSTGRES_PASSWORD=test-postgres-password
PASSWORD_MANAGER_DB_PASSWORD=
CT_OPS_INSTANCE_ID=
PASSWORD_MANAGER_CT_OPS_ISSUER=
PASSWORD_MANAGER_CT_OPS_AUDIENCE=
PASSWORD_MANAGER_CT_OPS_PRODUCT=
PASSWORD_MANAGER_CT_OPS_ED25519_PUBLIC_KEY=
PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY=
PASSWORD_MANAGER_TRUSTED_ORIGINS=
PASSWORD_MANAGER_SESSION_COOKIE_SECURE=
EOF

  (
    cd "$bundle_dir" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" MOCK_DOCKER_LOG="$docker_log" ./start.sh >/dev/null 2>&1
  )

  grep -q 'docker compose up --force-recreate --abort-on-container-exit --exit-code-from migrate migrate' "$docker_log"
  grep -q 'docker compose up --force-recreate --abort-on-container-exit --exit-code-from password-manager-migrate password-manager-migrate' "$docker_log"

  assert_password_manager_bootstrap \
    "$bundle_dir/.env" \
    "http://ct-ops.example.test" \
    "http://ct-ops.example.test" \
    "false"
}

main() {
  run_root_start_bootstrap_test
  run_bundle_start_bootstrap_test
  echo "password manager startup bootstrap tests passed"
}

main "$@"
