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
RELEASE_MANIFEST_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/.release-please-manifest.json"

latest_bundle_tag() {
  local manifest_tmp version
  manifest_tmp="$(mktemp -t ct-ops.XXXXXX.release-manifest.json)"
  if ! curl -fsSL -o "$manifest_tmp" "$RELEASE_MANIFEST_URL"; then
    rm -f "$manifest_tmp"
    echo "ERROR: could not download the CT-Ops release manifest." >&2
    echo "Try pinning the current release explicitly:" >&2
    echo "  CT_OPS_VERSION=v0.124.5 bash install.sh" >&2
    return 1
  fi

  version="$(awk -F '"' '$2 == "." { print $4; exit }' "$manifest_tmp")"
  rm -f "$manifest_tmp"

  if [[ ! "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
    echo "ERROR: could not read the latest bundle release from ${RELEASE_MANIFEST_URL}." >&2
    exit 1
  fi

  printf 'bundle/v%s\n' "$version"
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
  BUNDLE_TAG="${CT_OPS_VERSION}"
  if [[ "$BUNDLE_TAG" != bundle/* ]]; then
    BUNDLE_TAG="bundle/${BUNDLE_TAG}"
  fi
  VERSION="${BUNDLE_TAG#bundle/}"
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${BUNDLE_TAG}/ct-ops-single-${VERSION}.zip"
  CHECKSUM_URL="${URL}.sha256"
  echo "Downloading ct-ops ${VERSION}..."
else
  BUNDLE_TAG="$(latest_bundle_tag)"
  VERSION="${BUNDLE_TAG#bundle/}"
  URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${BUNDLE_TAG}/ct-ops-single.zip"
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
