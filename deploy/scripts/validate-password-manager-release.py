#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


TAG_RE = re.compile(r"^api/v\d+\.\d+\.\d+$")
SHA1_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]*$")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_string(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        fail(f"{key} must be a non-empty string")
    return value


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate-password-manager-release.py <path>")

    path = Path(sys.argv[1])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"{path} not found")
    except json.JSONDecodeError as exc:
        fail(f"{path} is not valid JSON: {exc}")

    if not isinstance(data, dict):
        fail("descriptor must be a JSON object")

    schema_version = data.get("schema_version")
    if schema_version != 1:
        fail("schema_version must be 1")

    repository = require_string(data, "repository")
    if repository != "carrtech-dev/ct-password-manager":
        fail("repository must be carrtech-dev/ct-password-manager")

    git_tag = require_string(data, "git_tag")
    if not TAG_RE.match(git_tag):
        fail("git_tag must match api/vX.Y.Z")

    source_commit_sha = require_string(data, "source_commit_sha")
    if not SHA1_RE.match(source_commit_sha):
        fail("source_commit_sha must be a 40-character lowercase git SHA")

    image_repository = require_string(data, "image_repository")
    if image_repository != "ghcr.io/carrtech-dev/ct-password-manager/api":
        fail("image_repository must be ghcr.io/carrtech-dev/ct-password-manager/api")

    image_digest = require_string(data, "image_digest")
    if not DIGEST_RE.match(image_digest):
        fail("image_digest must be a sha256 digest")

    digest_reference = require_string(data, "digest_reference")
    expected_ref = f"{image_repository}@{image_digest}"
    if digest_reference != expected_ref:
        fail("digest_reference must equal image_repository@image_digest")

    api_contract_version = require_string(data, "api_contract_version")
    if not VERSION_RE.match(api_contract_version):
        fail("api_contract_version must be a compact version string")

    api_contract_checksum = require_string(data, "api_contract_checksum_sha256")
    if not SHA256_RE.match(api_contract_checksum):
        fail("api_contract_checksum_sha256 must be a 64-character lowercase sha256")

    print(f"{path}: ok")


if __name__ == "__main__":
    main()
