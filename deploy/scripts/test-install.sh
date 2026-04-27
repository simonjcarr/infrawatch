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

if [[ "$url" == *.sha256 ]]; then
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
  export MOCK_CHECKSUM
  MOCK_CHECKSUM="$(printf '%s' "$MOCK_PAYLOAD" | openssl dgst -sha256 | awk '{print $NF}')"

  (
    cd "$workspace"
    PATH="${mockbin}:/usr/bin:/bin:/usr/sbin:/sbin" bash "$INSTALLER"
  )

  test -d "${workspace}/ct-ops"
}

run_mismatch_case() {
  local workspace="$1"
  local mockbin="${workspace}/mockbin"
  mkdir -p "$workspace" "$mockbin"
  make_mock_bin "$mockbin"

  export MOCK_PAYLOAD="tampered bundle payload"
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

main() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "'"$tmpdir"'"' EXIT

  run_match_case "${tmpdir}/match"
  run_mismatch_case "${tmpdir}/mismatch"
  echo "install.sh checksum verification tests passed"
}

main "$@"
