#!/usr/bin/env bash
# Generates a self-signed TLS certificate for local development.
# Output: deploy/dev-tls/server.crt and deploy/dev-tls/server.key
#
# These files are gitignored. Re-run this script after cloning or cleaning.
# For production, replace with a proper certificate from your CA.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/deploy/dev-tls"

mkdir -p "${OUTPUT_DIR}"

CERT="${OUTPUT_DIR}/server.crt"
KEY="${OUTPUT_DIR}/server.key"

if [[ -f "${CERT}" && -f "${KEY}" ]]; then
  echo "Dev TLS certificates already exist at ${OUTPUT_DIR}"
  echo "Delete them and re-run this script to regenerate."
  exit 0
fi

echo "Generating self-signed dev TLS certificate..."

openssl req -x509 \
  -newkey rsa:4096 \
  -keyout "${KEY}" \
  -out "${CERT}" \
  -days 365 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:ingest,IP:127.0.0.1" \
  2>/dev/null

echo "Generated:"
echo "  Certificate: ${CERT}"
echo "  Key:         ${KEY}"
echo ""
echo "To trust this certificate in the agent config, set:"
echo "  ca_cert_file = \"${CERT}\""
