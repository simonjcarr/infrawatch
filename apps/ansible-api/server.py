from __future__ import annotations

import json
import base64
import hashlib
import hmac
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


AUTH_SCHEME = "CT-ServiceToken"
SIGNATURE_PREFIX = "v1="
MAX_CLOCK_SKEW_SECONDS = 300
NONCE_TTL_SECONDS = 600
_seen_nonces: dict[str, float] = {}


def ansible_version() -> str:
    try:
        output = subprocess.check_output(
            ["ansible", "--version"],
            text=True,
            stderr=subprocess.STDOUT,
            timeout=3,
        )
    except Exception:
        return "unavailable"
    return output.splitlines()[0].replace("ansible [core ", "").replace("]", "").strip()


def health_payload() -> dict[str, Any]:
    version = ansible_version()
    return {
        "ok": version != "unavailable",
        "provider": "ansible",
        "ansibleVersion": version,
    }


def capabilities_payload() -> dict[str, Any]:
    return {
        "provider": "ansible",
        "version": "v1",
        "capabilities": {
            "health": True,
            "openapi": True,
            "jobExecution": True,
            "ansiblePing": True,
            "playbookExecution": False,
            "inventoryManagement": False,
            "credentialProfiles": False,
            "streamingLogs": False,
            "jobCancel": False,
            "dryRun": False,
        },
    }


def openapi_payload() -> dict[str, Any]:
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "CT-Ops Ansible Automation API",
            "version": "1.0.0",
        },
        "paths": {
            "/healthz": {
                "get": {
                    "summary": "Check Ansible API health",
                    "responses": {"200": {"description": "Health status"}},
                },
            },
            "/api/v1/capabilities": {
                "get": {
                    "summary": "Describe supported automation capabilities",
                    "responses": {"200": {"description": "Capabilities"}},
                },
            },
            "/api/v1/openapi.json": {
                "get": {
                    "summary": "Return the OpenAPI document",
                    "responses": {"200": {"description": "OpenAPI JSON"}},
                },
            },
            "/api/v1/runs/ansible-ping": {
                "post": {
                    "summary": "Run the Ansible ping module against supplied SSH inventory",
                    "responses": {
                        "200": {"description": "Per-host Ansible ping result"},
                        "400": {"description": "Invalid request"},
                    },
                },
            },
        },
    }


def _configured_service_token() -> tuple[str, str] | None:
    token_id = os.environ.get("ANSIBLE_API_SERVICE_TOKEN_ID", "").strip()
    token_secret = os.environ.get("ANSIBLE_API_SERVICE_TOKEN_SECRET", "")
    if not token_id and not token_secret:
        return None
    if not token_id or len(token_secret.encode("utf-8")) < 32:
        raise PermissionError("Ansible API service token is not configured correctly")
    return token_id, token_secret


def _header(headers: Any, name: str) -> str:
    if hasattr(headers, "get"):
        value = headers.get(name)
        if value is not None:
            return str(value)
        value = headers.get(name.lower())
        if value is not None:
            return str(value)
    lower = name.lower()
    for key, value in dict(headers).items():
        if str(key).lower() == lower:
            return str(value)
    return ""


def _parse_timestamp(value: str) -> float:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _remember_nonce(token_id: str, nonce: str, now: float) -> bool:
    expired = [key for key, expires_at in _seen_nonces.items() if expires_at <= now]
    for key in expired:
        del _seen_nonces[key]
    key = f"{token_id}:{nonce}"
    if key in _seen_nonces:
        return False
    _seen_nonces[key] = now + NONCE_TTL_SECONDS
    return True


def verify_service_request(method: str, path: str, body: bytes, headers: Any) -> None:
    token = _configured_service_token()
    if token is None:
        return
    token_id, token_secret = token

    authorization = _header(headers, "authorization")
    parts = authorization.split()
    if len(parts) != 2 or parts[0] != AUTH_SCHEME or parts[1] != token_id:
        raise PermissionError("invalid service token authorization")

    timestamp = _header(headers, "x-ct-timestamp")
    nonce = _header(headers, "x-ct-nonce")
    content_hash = _header(headers, "x-ct-content-sha256")
    signature_header = _header(headers, "x-ct-signature")
    if not timestamp or not nonce or not content_hash or not signature_header:
        raise PermissionError("missing service token signature headers")

    try:
        request_time = _parse_timestamp(timestamp)
    except Exception as err:
        raise PermissionError("invalid service token timestamp") from err
    now = time.time()
    if abs(now - request_time) > MAX_CLOCK_SKEW_SECONDS:
        raise PermissionError("service token timestamp is outside the replay window")

    expected_hash = hashlib.sha256(body).hexdigest()
    if not hmac.compare_digest(content_hash, expected_hash):
        raise PermissionError("service token content hash does not match")

    if not signature_header.startswith(SIGNATURE_PREFIX):
        raise PermissionError("invalid service token signature")
    input_value = "\n".join([method.upper(), path, timestamp, nonce, expected_hash]).encode("utf-8")
    expected_signature = base64.urlsafe_b64encode(
        hmac.new(token_secret.encode("utf-8"), input_value, hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    if not hmac.compare_digest(signature_header[len(SIGNATURE_PREFIX):], expected_signature):
        raise PermissionError("invalid service token signature")

    if not _remember_nonce(token_id, nonce, now):
        raise PermissionError("service token nonce has already been used")


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str
    elapsedMs: int


def _private_key_is_valid(value: str) -> bool:
    stripped = value.strip()
    return stripped.startswith("-----BEGIN ") and " PRIVATE KEY-----" in stripped and "-----END " in stripped


def validate_ansible_ping_request(payload: dict[str, Any]) -> dict[str, Any]:
    hosts = payload.get("hosts")
    credential = payload.get("credential")
    if not isinstance(hosts, list) or len(hosts) == 0:
        raise ValueError("hosts must be a non-empty list")
    if len(hosts) > 100:
        raise ValueError("hosts must contain 100 entries or fewer")
    if not isinstance(credential, dict):
        raise ValueError("credential is required")

    username = credential.get("username")
    private_key = credential.get("privateKey")
    if not isinstance(username, str) or not username.strip():
        raise ValueError("credential.username is required")
    if not isinstance(private_key, str) or not _private_key_is_valid(private_key):
        raise ValueError("credential.privateKey must be an SSH private key")

    cleaned_hosts: list[dict[str, Any]] = []
    for host in hosts:
        if not isinstance(host, dict):
            raise ValueError("each host must be an object")
        host_id = host.get("id")
        name = host.get("name")
        address = host.get("address")
        port = host.get("port", 22)
        if not isinstance(host_id, str) or not host_id:
            raise ValueError("host.id is required")
        if not isinstance(name, str) or not name:
            raise ValueError("host.name is required")
        if not isinstance(address, str) or not address:
            raise ValueError("host.address is required")
        if not isinstance(port, int) or port < 1 or port > 65535:
            raise ValueError("host.port must be between 1 and 65535")
        cleaned_hosts.append({"id": host_id, "name": name, "address": address, "port": port})

    return {
        "credential": {"username": username.strip(), "privateKey": private_key},
        "hosts": cleaned_hosts,
    }


def inventory_text(hosts: list[dict[str, Any]], username: str) -> str:
    lines = ["[ct_ops_targets]"]
    for host in hosts:
        lines.append(
            f"{host['name']} ansible_host={host['address']} ansible_user={username} ansible_port={host['port']}"
        )
    return "\n".join(lines) + "\n"


def run_ansible_ping_command(payload: dict[str, Any]) -> CommandResult:
    start = time.monotonic()
    credential = payload["credential"]
    hosts = payload["hosts"]
    with tempfile.TemporaryDirectory(prefix="ctops-ansible-") as tmpdir:
        key_path = os.path.join(tmpdir, "id_key")
        inventory_path = os.path.join(tmpdir, "inventory.ini")
        with open(key_path, "w", encoding="utf-8") as key_file:
            key_file.write(credential["privateKey"].strip() + "\n")
        os.chmod(key_path, 0o600)
        with open(inventory_path, "w", encoding="utf-8") as inventory_file:
            inventory_file.write(inventory_text(hosts, credential["username"]))

        env = {
            **os.environ,
            "ANSIBLE_HOST_KEY_CHECKING": os.environ.get("ANSIBLE_HOST_KEY_CHECKING", "False"),
            "ANSIBLE_STDOUT_CALLBACK": "json",
        }
        proc = subprocess.run(
            [
                "ansible",
                "ct_ops_targets",
                "-i",
                inventory_path,
                "--private-key",
                key_path,
                "-m",
                "ping",
            ],
            text=True,
            capture_output=True,
            timeout=45,
            env=env,
        )

    return CommandResult(
        returncode=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        elapsedMs=int((time.monotonic() - start) * 1000),
    )


def _host_result_from_json(stdout: str, host_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(stdout)
    except Exception:
        return None
    plays = data.get("plays")
    if not isinstance(plays, list):
        return None
    for play in plays:
        for task in play.get("tasks", []) if isinstance(play, dict) else []:
            hosts = task.get("hosts") if isinstance(task, dict) else None
            if not isinstance(hosts, dict) or host_id not in hosts:
                continue
            result = hosts[host_id]
            if isinstance(result, dict):
                return result
    return None


def _host_succeeded_from_json(stdout: str, host_id: str) -> bool | None:
    result = _host_result_from_json(stdout, host_id)
    if result is None:
        return None
    return bool(result.get("ping") == "pong" or result.get("ok", 0)) and not bool(result.get("failed", False))


def _host_stdout(stdout: str, host_id: str, host_ids: set[str]) -> str:
    result = _host_result_from_json(stdout, host_id)
    if result is not None:
        return json.dumps({host_id: result}, indent=2, sort_keys=True) + "\n"

    lines = stdout.splitlines()
    if not lines:
        return stdout

    selected: list[str] = []
    collecting = False
    for line in lines:
        starts_host_block = any(line.startswith(f"{candidate} |") for candidate in host_ids)
        if starts_host_block:
            collecting = line.startswith(f"{host_id} |")
        if collecting:
            selected.append(line)

    if not selected and not any(host in stdout for host in host_ids):
        return stdout
    return "\n".join(selected) + ("\n" if selected else "")


def _host_stderr(stderr: str, host_id: str, host_ids: set[str]) -> str:
    lines = stderr.splitlines()
    if not lines:
        return stderr

    selected = [line for line in lines if host_id in line]
    if not selected and not any(host in stderr for host in host_ids):
        return stderr
    return "\n".join(selected) + ("\n" if selected else "")


def run_ansible_ping(payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_ansible_ping_request(payload)
    command = run_ansible_ping_command(request)
    results = []
    host_names = {host["name"] for host in request["hosts"]}

    for host in request["hosts"]:
        succeeded = _host_succeeded_from_json(command.stdout, host["name"])
        if succeeded is None:
            succeeded = command.returncode == 0
        results.append({
            "id": host["id"],
            "name": host["name"],
            "status": "success" if succeeded else "failed",
            "exitCode": 0 if succeeded else (command.returncode or 1),
            "stdout": _host_stdout(command.stdout, host["name"], host_names),
            "stderr": _host_stderr(command.stderr, host["name"], host_names),
        })

    return {
        "ok": all(host["status"] == "success" for host in results),
        "elapsedMs": command.elapsedMs,
        "hosts": results,
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.write_json(health_payload())
            return
        if self.path == "/api/v1/capabilities":
            self.write_json(capabilities_payload())
            return
        if self.path == "/api/v1/openapi.json":
            self.write_json(openapi_payload())
            return

        self.write_json({"error": "not_found"}, status=404)

    def do_POST(self) -> None:
        if self.path == "/api/v1/runs/ansible-ping":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(min(length, 1_000_000))
                verify_service_request("POST", self.path, body, self.headers)
                payload = json.loads(body.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("request body must be an object")
                self.write_json(run_ansible_ping(payload))
            except PermissionError as err:
                self.write_json({"error": str(err)}, status=401)
            except ValueError as err:
                self.write_json({"error": str(err)}, status=400)
            except subprocess.TimeoutExpired:
                self.write_json({"error": "ansible ping timed out"}, status=504)
            except Exception:
                self.write_json({"error": "ansible ping failed"}, status=500)
            return

        self.write_json({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
