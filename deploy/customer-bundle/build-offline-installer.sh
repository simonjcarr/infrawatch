#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT-Ops — Build Offline Installer
#
# Run on an internet-connected host after unzipping the standard CT-Ops
# release. Pulls every image referenced by docker-compose.yml, saves them to
# images.tar.gz, and re-zips this directory as
# ct-ops-single-{VERSION}-airgap.zip in the parent directory.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: 'docker' is not installed or not on PATH." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' plugin not found." >&2
  exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' is required to package the air-gap bundle." >&2
  exit 1
fi
if [ ! -f docker-compose.yml ]; then
  echo "ERROR: docker-compose.yml not found in $(pwd)." >&2
  echo "Run this script from inside the unzipped CT-Ops bundle." >&2
  exit 1
fi

VERSION=$(cat VERSION 2>/dev/null || echo "unknown")

# Compose variable substitution is strict, so provide placeholders purely to
# render config. These values are not persisted or used at runtime.
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-build-time-placeholder}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-build-time-placeholder}"

echo "Resolving image names from docker-compose.yml..."
IMAGES=$(docker compose config --images 2>/dev/null | sort -u)
if [ -z "$IMAGES" ]; then
  echo "ERROR: could not resolve any image names from docker-compose.yml" >&2
  exit 1
fi

echo "Images:"
while IFS= read -r img; do printf '  %s\n' "$img"; done <<< "$IMAGES"

echo "Pulling images (this may take a while)..."
while IFS= read -r img; do
  docker pull "$img"
done <<< "$IMAGES"

echo "Saving images to images.tar.gz..."
# shellcheck disable=SC2086
docker save $IMAGES | gzip > images.tar.gz
echo "  $(du -h images.tar.gz | cut -f1) written."

PARENT="$(dirname "$SCRIPT_DIR")"
DIRNAME="$(basename "$SCRIPT_DIR")"
OUT="$PARENT/ct-ops-single-${VERSION}-airgap.zip"

echo "Re-zipping bundle as $OUT..."
(cd "$PARENT" && zip -r "$OUT" "$DIRNAME" \
  -x "$DIRNAME/.env" \
  -x "$DIRNAME/deploy/tls/*" \
  -x "$DIRNAME/deploy/dev-tls/*" \
  -x "$DIRNAME/ct-ops-single-*-airgap.zip" >/dev/null)

echo ""
echo "Air-gap bundle ready: $OUT"
echo "Transfer it to your air-gapped target host, unzip, and run ./start.sh"
