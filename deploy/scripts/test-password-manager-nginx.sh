#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NGINX_CONF="${REPO_ROOT}/deploy/nginx/nginx.conf"

require_line() {
  local pattern="$1"

  if command -v rg >/dev/null 2>&1; then
    if rg -q "$pattern" "$NGINX_CONF"; then
      return 0
    fi
  elif grep -Eq "$pattern" "$NGINX_CONF"; then
    return 0
  fi

  echo "expected nginx config to match: $pattern" >&2
  exit 1
}

location_block() {
  local prefix="$1"

  awk -v location="$prefix" '
    $0 == "    location " location " {" {
      in_block = 1
      print
      next
    }
    in_block && $0 ~ /^    location / {
      exit
    }
    in_block && $0 == "  }" {
      exit
    }
    in_block {
      print
    }
  ' "$NGINX_CONF"
}

password_manager_api_block="$(location_block "/password-manager-api/")"

require_line '^  upstream ct_password_manager_api \{$'
require_line '^    server password-manager-api:8080;$'

if [[ -z "$password_manager_api_block" ]]; then
  echo "expected /password-manager-api/ location block" >&2
  exit 1
fi

if [[ "$password_manager_api_block" != *$'\n      proxy_pass http://ct_password_manager_api/;'* ]]; then
  echo "password manager proxy must strip only the /password-manager-api/ prefix" >&2
  exit 1
fi

if [[ "$password_manager_api_block" != *$'\n      proxy_set_header Upgrade    "";'* ]]; then
  echo "password manager proxy must clear Upgrade header" >&2
  exit 1
fi

if [[ "$password_manager_api_block" != *$'\n      proxy_set_header Connection "";'* ]]; then
  echo "password manager proxy must clear Connection header" >&2
  exit 1
fi

if [[ "$password_manager_api_block" != *$'\n      proxy_set_header Host              $host;'* ]]; then
  echo "password manager proxy must forward Host header" >&2
  exit 1
fi

echo "password manager nginx routing test passed"
