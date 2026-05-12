#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKFLOW="${REPO_ROOT}/.github/workflows/agent-release.yml"
RELEASE_CONFIG="${REPO_ROOT}/release-please-config.json"
MANIFEST="${REPO_ROOT}/.release-please-manifest.json"

assert_contains() {
  local file="$1"
  local needle="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "expected ${file} to contain: ${needle}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  if grep -Fq "$needle" "$file"; then
    echo "expected ${file} not to contain: ${needle}" >&2
    exit 1
  fi
}

python3 - "$RELEASE_CONFIG" "$MANIFEST" <<'PY'
import json
import sys

config_path, manifest_path = sys.argv[1:]
config = json.load(open(config_path, encoding="utf-8"))
manifest = json.load(open(manifest_path, encoding="utf-8"))
bundle = config["packages"].get(".")
assert bundle, "missing root bundle release-please package"
assert bundle["component"] == "bundle", bundle
assert bundle["include-component-in-tag"] is True, bundle
assert "." in manifest, "missing bundle version in release-please manifest"
PY

assert_contains "$WORKFLOW" "bundle_release_created: \${{ steps.release.outputs.release_created }}"
assert_contains "$WORKFLOW" "bundle_tag_name:        \${{ steps.release.outputs.tag_name }}"
assert_contains "$WORKFLOW" "needs.release-please.outputs.bundle_release_created == 'true'"
assert_contains "$WORKFLOW" "ref: \${{ needs.release-please.outputs.bundle_tag_name }}"
assert_contains "$WORKFLOW" "tag_name: \${{ needs.release-please.outputs.bundle_tag_name }}"
assert_contains "$WORKFLOW" "VERSION=\"\${TAG#bundle/}\""

assert_contains "$WORKFLOW" "resolve_released_image_ref web \"\$WEB_VERSION\""
assert_contains "$WORKFLOW" "resolve_released_image_ref ingest \"\$INGEST_VERSION\""
assert_contains "$WORKFLOW" "resolve_released_image_ref ansible-api \"\$ANSIBLE_API_VERSION\""
assert_contains "$WORKFLOW" "needs.build-web-image.outputs.image_ref"
assert_contains "$WORKFLOW" "needs.build-ingest-image.outputs.image_ref"
assert_contains "$WORKFLOW" "needs.build-ansible-api-image.outputs.image_ref"

assert_contains "$WORKFLOW" "WEB_IMAGE_REF="
assert_contains "$WORKFLOW" "INGEST_IMAGE_REF="
assert_contains "$WORKFLOW" "ANSIBLE_API_IMAGE_REF="
assert_contains "$WORKFLOW" "grep -Fxq \"\${WEB_IMAGE_REF}\" <<< \"\$refs\""
assert_contains "$WORKFLOW" "grep -Fxq \"\${INGEST_IMAGE_REF}\" <<< \"\$refs\""
assert_contains "$WORKFLOW" "grep -Fxq \"\${ANSIBLE_API_IMAGE_REF}\" <<< \"\$refs\""
assert_not_contains "$WORKFLOW" "imagetools inspect ghcr.io/carrtech-dev/ct-ops/ingest:latest"
assert_not_contains "$WORKFLOW" "imagetools inspect ghcr.io/carrtech-dev/ct-ops/ansible-api:latest"

echo "agent-release bundle checks passed"
