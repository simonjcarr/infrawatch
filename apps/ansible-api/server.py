from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


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
            f"{host['id']} ansible_host={host['address']} ansible_user={username} ansible_port={host['port']}"
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


def _host_succeeded_from_json(stdout: str, host_id: str) -> bool | None:
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
                return bool(result.get("ping") == "pong" or result.get("ok", 0)) and not bool(result.get("failed", False))
    return None


def run_ansible_ping(payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_ansible_ping_request(payload)
    command = run_ansible_ping_command(request)
    results = []

    for host in request["hosts"]:
        succeeded = _host_succeeded_from_json(command.stdout, host["id"])
        if succeeded is None:
            succeeded = command.returncode == 0
        results.append({
            "id": host["id"],
            "name": host["name"],
            "status": "success" if succeeded else "failed",
            "exitCode": 0 if succeeded else (command.returncode or 1),
            "stdout": command.stdout,
            "stderr": command.stderr,
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
                payload = json.loads(body.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("request body must be an object")
                self.write_json(run_ansible_ping(payload))
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
