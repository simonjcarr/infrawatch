#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALLER="${REPO_ROOT}/install.sh"

make_mock_bin() {
  local dir="$1"

  cat > "${dir}/docker" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "${dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

if [[ -z "$out" || -z "$url" ]]; then
  echo "mock curl expected -o <file> <url>" >&2
  exit 2
fi

if [[ -n "${MOCK_CURL_LOG:-}" ]]; then
  printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
fi

if [[ "$url" == "https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/.release-please-manifest.json" ]]; then
  printf '%s' "${MOCK_RELEASE_MANIFEST_JSON}" > "$out"
elif [[ "$url" == *.sha256 ]]; then
  printf '%s  ct-ops-single.zip\n' "${MOCK_CHECKSUM}" > "$out"
else
  printf '%s' "${MOCK_PAYLOAD}" > "$out"
fi
EOF

  cat > "${dir}/unzip" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${UNZIP_SHOULD_FAIL:-0}" = "1" ]; then
  echo "unzip should not have been called" >&2
  exit 99
fi

mkdir -p ct-ops
exit 0
EOF

  chmod +x "${dir}/docker" "${dir}/curl" "${dir}/unzip"
}

run_match_case() {
  local workspace="$1"
  local mockbin="${workspace}/mockbin"
  mkdir -p "$workspace" "$mockbin"
  make_mock_bin "$mockbin"

  export MOCK_PAYLOAD="verified bundle payload"
  export MOCK_RELEASE_MANIFEST_JSON='{
    "agent": "9.9.9",
    "apps/ingest": "9.9.9",
    "apps/web": "0.100.0",
    ".": "0.100.0"
  }'
  export MOCK_CURL_LOG="${workspace}/curl.log"
  export MOCK_CHECKSUM
  MOCK_CHECKSUM="$(printf '%s' "$MOCK_PAYLOAD" | openssl dgst -sha256 | awk '{print $NF}')"

  (
    cd "$workspace"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" bash "$INSTALLER"
  )

  test -d "${workspace}/ct-ops"
  grep -Fxq "https://github.com/carrtech-dev/ct-ops/releases/download/bundle/v0.100.0/ct-ops-single.zip" "$MOCK_CURL_LOG"
  grep -Fxq "https://github.com/carrtech-dev/ct-ops/releases/download/bundle/v0.100.0/ct-ops-single.zip.sha256" "$MOCK_CURL_LOG"
  if grep -Fq "/releases/latest/" "$MOCK_CURL_LOG"; then
    echo "installer should not use GitHub's repo-wide latest release URL" >&2
    exit 1
  fi
  unset MOCK_CURL_LOG
  unset MOCK_RELEASE_MANIFEST_JSON
}

run_mismatch_case() {
  local workspace="$1"
  local mockbin="${workspace}/mockbin"
  mkdir -p "$workspace" "$mockbin"
  make_mock_bin "$mockbin"

  export MOCK_PAYLOAD="tampered bundle payload"
  export MOCK_RELEASE_MANIFEST_JSON='{ ".": "1.2.3" }'
  export MOCK_CHECKSUM="deadbeef"
  export UNZIP_SHOULD_FAIL="1"

  set +e
  local output
  output="$(
    cd "$workspace" &&
      PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" bash "$INSTALLER" 2>&1
  )"
  local status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "expected checksum mismatch failure" >&2
    exit 1
  fi

  if [[ "$output" != *"bundle checksum mismatch"* ]]; then
    echo "expected checksum mismatch message, got:" >&2
    echo "$output" >&2
    exit 1
  fi

  test ! -d "${workspace}/ct-ops"
  unset UNZIP_SHOULD_FAIL
}

run_pinned_case() {
  local workspace="$1"
  local mockbin="${workspace}/mockbin"
  mkdir -p "$workspace" "$mockbin"
  make_mock_bin "$mockbin"

  export MOCK_PAYLOAD="verified pinned bundle payload"
  export MOCK_RELEASE_MANIFEST_JSON='{ "apps/web": "9.9.9" }'
  export MOCK_CURL_LOG="${workspace}/curl.log"
  export MOCK_CHECKSUM
  MOCK_CHECKSUM="$(printf '%s' "$MOCK_PAYLOAD" | openssl dgst -sha256 | awk '{print $NF}')"

  (
    cd "$workspace"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" CT_OPS_VERSION=v4.5.6 bash "$INSTALLER"
  )

  test -d "${workspace}/ct-ops"
  grep -Fxq "https://github.com/carrtech-dev/ct-ops/releases/download/bundle/v4.5.6/ct-ops-single-v4.5.6.zip" "$MOCK_CURL_LOG"
  if grep -Fq ".release-please-manifest.json" "$MOCK_CURL_LOG"; then
    echo "pinned installs should not query the release manifest" >&2
    exit 1
  fi
  unset MOCK_CURL_LOG
}

main() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  run_match_case "${tmpdir}/match"
  run_mismatch_case "${tmpdir}/mismatch"
  run_pinned_case "${tmpdir}/pinned"
  echo "install.sh checksum verification tests passed"
}

main "$@"
