#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

main() {
  local tmpdir cert_text
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  OUT_DIR="$tmpdir" "${SCRIPT_DIR}/gen-server-cert.sh" >/dev/null

  cert_text="$(openssl x509 -in "$tmpdir/server.crt" -noout -text)"

  if [[ "$cert_text" != *"DNS:ct-ops"* ]]; then
    echo "expected generated cert SANs to include DNS:ct-ops" >&2
    echo "$cert_text" >&2
    exit 1
  fi
  if [[ "$cert_text" != *"DNS:localhost"* ]]; then
    echo "expected generated cert SANs to include DNS:localhost" >&2
    echo "$cert_text" >&2
    exit 1
  fi
  if [[ "$cert_text" != *"DNS:ingest"* ]]; then
    echo "expected generated cert SANs to include DNS:ingest" >&2
    echo "$cert_text" >&2
    exit 1
  fi

  echo "gen-server-cert SAN test passed"
}

main "$@"
