#!/usr/bin/env bash
set -euo pipefail

# Fetches the current CT-Ops licence verifier public key from the public
# CarrTech key repository and writes it into a customer bundle directory.

REPO_URL="${LICENCE_PUBLIC_KEYS_REPO:-https://github.com/carrtech-dev/licence-public-keys.git}"
REF="${LICENCE_PUBLIC_KEYS_REF:-main}"
OUT_FILE="${1:-deploy/customer-bundle/licence-keys/current.pem}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found in PATH." >&2
    exit 1
  fi
}

need git
need openssl

WORK_DIR="$(mktemp -d -t ct-ops-public-keys.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --depth 1 --branch "$REF" "$REPO_URL" "$WORK_DIR/licence-public-keys" >/dev/null

SOURCE_FILE="$WORK_DIR/licence-public-keys/ct-ops/current.pem"
if [ ! -f "$SOURCE_FILE" ]; then
  echo "ERROR: public key repository does not contain ct-ops/current.pem." >&2
  exit 1
fi

if ! grep -q '^-----BEGIN PUBLIC KEY-----$' "$SOURCE_FILE" ||
   ! grep -q '^-----END PUBLIC KEY-----$' "$SOURCE_FILE"; then
  echo "ERROR: ct-ops/current.pem is not a PEM public key." >&2
  exit 1
fi

openssl pkey -pubin -in "$SOURCE_FILE" -noout >/dev/null

mkdir -p "$(dirname "$OUT_FILE")"
install -m 644 "$SOURCE_FILE" "$OUT_FILE"

fingerprint="$(
  openssl pkey -pubin -in "$OUT_FILE" -outform DER |
    openssl dgst -sha256 -binary |
    od -An -tx1 |
    tr -d ' \n'
)"

echo "Fetched CT-Ops licence verifier key from ${REPO_URL}@${REF}"
echo "Wrote: ${OUT_FILE}"
echo "SHA256 SPKI: ${fingerprint}"
