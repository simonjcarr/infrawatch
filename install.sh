#!/usr/bin/env bash
#
# ct-ops one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
#
# The installer verifies the published SHA-256 checksum before unpacking.
#
# Optional: pin a specific version.
#
#   curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh \
#     | CT_OPS_VERSION=v0.3.0 bash
#
set -euo pipefail

REPO_OWNER="carrtech-dev"
REPO_NAME="ct-ops"

latest_web_tag() {
  local releases_tmp
  releases_tmp="$(mktemp -t ct-ops.XXXXXX.releases.json)"

  if ! curl -fsSL \
    -o "$releases_tmp" \
    "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100"; then
    rm -f "$releases_tmp"
    return 1
  fi

  local tag
  tag="$(awk -F '"' '/"tag_name":[[:space:]]*"web\/v[0-9][^"]*"/ { print $4; exit }' "$releases_tmp")"
  rm -f "$releases_tmp"

  if [ -z "$tag" ]; then
    echo "ERROR: could not find a published web release for ${REPO_OWNER}/${REPO_NAME}." >&2
    exit 1
  fi

  printf '%s\n' "$tag"
}

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
  WEB_TAG="${CT_OPS_VERSION}"
  if [[ "$WEB_TAG" != web/* ]]; then
    WEB_TAG="web/${WEB_TAG}"
  fi
  VERSION="${WEB_TAG#web/}"
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${WEB_TAG}/ct-ops-single-${VERSION}.zip"
  CHECKSUM_URL="${URL}.sha256"
  echo "Downloading ct-ops ${VERSION}..."
else
  WEB_TAG="$(latest_web_tag)"
  VERSION="${WEB_TAG#web/}"
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${WEB_TAG}/ct-ops-single.zip"
  CHECKSUM_URL="${URL}.sha256"
  echo "Downloading the latest ct-ops release (${VERSION})..."
fi

TMP=$(mktemp -t ct-ops.XXXXXX.zip)
CHECKSUM_TMP=$(mktemp -t ct-ops.XXXXXX.sha256)
trap 'rm -f "$TMP" "$CHECKSUM_TMP"' EXIT

curl -fsSL -o "$TMP" "$URL"
curl -fsSL -o "$CHECKSUM_TMP" "$CHECKSUM_URL"

EXPECTED_CHECKSUM="$(awk 'NF { print $1; exit }' "$CHECKSUM_TMP" | tr '[:upper:]' '[:lower:]')"
ACTUAL_CHECKSUM="$(openssl dgst -sha256 "$TMP" | awk '{print $NF}' | tr '[:upper:]' '[:lower:]')"

if [ -z "$EXPECTED_CHECKSUM" ]; then
  echo "ERROR: failed to read bundle checksum from ${CHECKSUM_URL}" >&2
  exit 1
fi

if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
  echo "ERROR: bundle checksum mismatch." >&2
  echo "Expected: $EXPECTED_CHECKSUM" >&2
  echo "Actual:   $ACTUAL_CHECKSUM" >&2
  exit 1
fi

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
