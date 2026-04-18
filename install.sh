#!/usr/bin/env bash
#
# Infrawatch one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
#
# Optional: pin a specific version.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh \
#     | INFRAWATCH_VERSION=v0.3.0 bash
#
set -euo pipefail

REPO_OWNER="carrtech-dev"
REPO_NAME="ct-ops"

if [ "$(id -u)" = "0" ]; then
  echo "ERROR: do not run this installer as root." >&2
  echo "Run it as the user that will operate Infrawatch (must be in the docker group)." >&2
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

if [ -d "infrawatch" ]; then
  echo "ERROR: ./infrawatch already exists. Move or remove it first." >&2
  exit 1
fi

if [ -n "${INFRAWATCH_VERSION:-}" ]; then
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/web/${INFRAWATCH_VERSION}/infrawatch-single-${INFRAWATCH_VERSION}.zip"
  echo "Downloading Infrawatch ${INFRAWATCH_VERSION}..."
else
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/infrawatch-single.zip"
  echo "Downloading the latest Infrawatch release..."
fi

TMP=$(mktemp -t infrawatch.XXXXXX.zip)
trap 'rm -f "$TMP"' EXIT

curl -fsSL -o "$TMP" "$URL"
unzip -q "$TMP" -d .

echo ""
echo "Installed to ./infrawatch"
echo ""
echo "Next steps:"
echo "  cd infrawatch"
echo "  ./start.sh        # creates .env from the example"
echo "  \$EDITOR .env      # set BETTER_AUTH_URL etc."
echo "  ./start.sh        # boots the stack"
echo ""
