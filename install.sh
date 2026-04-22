#!/usr/bin/env bash
#
# ct-ops one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
#
# Optional: pin a specific version.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh \
#     | CT_OPS_VERSION=v0.3.0 bash
#
set -euo pipefail

REPO_OWNER="carrtech-dev"
REPO_NAME="ct-ops"

if [ "$(id -u)" = "0" ]; then
  echo "ERROR: do not run this installer as root." >&2
  echo "Run it as the user that will operate ct-ops (must be in the docker group)." >&2
  exit 1
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found in PATH" >&2
    exit 1
  fi
}
need docker
need curl
need unzip
need openssl

if [ -d "ct-ops" ]; then
  echo "ERROR: ./ct-ops already exists. Move or remove it first." >&2
  exit 1
fi

if [ -n "${CT_OPS_VERSION:-}" ]; then
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/web/${CT_OPS_VERSION}/ct-ops-single-${CT_OPS_VERSION}.zip"
  echo "Downloading ct-ops ${CT_OPS_VERSION}..."
else
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/ct-ops-single.zip"
  echo "Downloading the latest ct-ops release..."
fi

TMP=$(mktemp -t ct-ops.XXXXXX.zip)
trap 'rm -f "$TMP"' EXIT

curl -fsSL -o "$TMP" "$URL"
unzip -q "$TMP" -d .

echo ""
echo "Installed to ./ct-ops"
echo ""
echo "Next steps:"
echo "  cd ct-ops"
echo "  ./start.sh        # creates .env from the example"
echo "  \$EDITOR .env      # set BETTER_AUTH_URL etc."
echo "  ./start.sh        # boots the stack"
echo ""
