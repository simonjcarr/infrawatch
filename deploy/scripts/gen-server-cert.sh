#!/usr/bin/env bash
# Generates a self-signed TLS certificate (RSA 4096, SHA-256, 365-day).
#
# Used by:
#   - deploy/customer-bundle/start.sh to produce the browser-facing nginx cert
#   - deploy/scripts/gen-dev-tls.sh to produce the ingest mTLS dev cert
#
# Env vars:
#   OUT_DIR      Directory to write server.crt / server.key. Required.
#   CN           Certificate common name. Default: ct-ops.
#   EXTRA_SANS   Extra SAN entries appended to the auto-discovered list,
#                comma-separated. Example: DNS:ct-ops.example.com
#   FORCE        When "1", regenerate even if both files already exist.
#
# Behaviour:
#   - Idempotent: exits 0 if OUT_DIR/server.crt and server.key both exist
#     unless FORCE=1.
#   - Always includes DNS:localhost, DNS:ingest, DNS:ct-ops, IP:127.0.0.1
#     in the SAN list.
#   - Appends every non-loopback IPv4 address on the host (so remote agents
#     can verify by IP against a cert generated on the server).
#   - Writes the key with mode 600 and the cert with mode 644.

set -euo pipefail

: "${OUT_DIR:?OUT_DIR must be set}"
CN="${CN:-ct-ops}"
EXTRA_SANS="${EXTRA_SANS:-}"
FORCE="${FORCE:-0}"

CERT="${OUT_DIR}/server.crt"
KEY="${OUT_DIR}/server.key"

if [ "$FORCE" != "1" ] && [ -f "$CERT" ] && [ -f "$KEY" ]; then
  echo "Server certificate already present at ${OUT_DIR} — skipping generation."
  echo "Set FORCE=1 to regenerate."
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: 'openssl' is required to generate server certificates." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

LOCAL_IPS=""
if command -v ip >/dev/null 2>&1; then
  LOCAL_IPS=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print "IP:" a[1]}' | tr '\n' ',' | sed 's/,$//' || true)
elif command -v ifconfig >/dev/null 2>&1; then
  LOCAL_IPS=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print "IP:" $2}' | tr '\n' ',' | sed 's/,$//' || true)
fi

SAN="DNS:localhost,DNS:ingest,DNS:ct-ops,IP:127.0.0.1"
[ -n "$LOCAL_IPS" ] && SAN="${SAN},${LOCAL_IPS}"
[ -n "$EXTRA_SANS" ] && SAN="${SAN},${EXTRA_SANS}"

openssl req -x509 -newkey rsa:4096 \
  -keyout "$KEY" \
  -out "$CERT" \
  -sha256 -days 365 -nodes \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=${SAN}" 2>/dev/null

chmod 600 "$KEY"
chmod 644 "$CERT"

echo "Wrote ${CERT} (CN=${CN}, SANs: ${SAN})"
