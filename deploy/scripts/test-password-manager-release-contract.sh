#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DESCRIPTOR="${REPO_ROOT}/deploy/password-manager-release.json"
CLIENT_TEST="${REPO_ROOT}/apps/web/lib/password-manager/client.test.mjs"

expected_ref="ghcr.io/carrtech-dev/ct-password-manager/api@sha256:91c7e5fa77e4bf26115c0f071713856571a8873c4b4e1ab600c53ba78f80fee7"

python3 "${REPO_ROOT}/deploy/scripts/validate-password-manager-release.py" "$DESCRIPTOR" >/dev/null

python3 - <<'EOF' "$DESCRIPTOR" "$expected_ref"
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected_ref = sys.argv[2]
actual_ref = data["digest_reference"]
if actual_ref != expected_ref:
    raise SystemExit(f"expected Password Manager API image {expected_ref}, got {actual_ref}")

git_tag = data["git_tag"]
prefix = "api/v"
if not git_tag.startswith(prefix):
    raise SystemExit(f"expected Password Manager API api/v0.1.2 or newer, got {git_tag}")
try:
    version = tuple(int(part) for part in git_tag[len(prefix):].split("."))
except ValueError as exc:
    raise SystemExit(f"expected Password Manager API api/v0.1.2 or newer, got {git_tag}") from exc
if len(version) != 3 or version < (0, 1, 2):
    raise SystemExit(f"expected Password Manager API api/v0.1.2 or newer, got {git_tag}")
EOF

if ! grep -q "createUserKeyPayload accepts the CT-Ops browser-envelope setup payload" "$CLIENT_TEST"; then
  echo "missing CT-Ops browser-envelope user-key payload contract test" >&2
  exit 1
fi

echo "password manager release contract test passed"
