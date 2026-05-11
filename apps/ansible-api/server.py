from __future__ import annotations

import json
import os
import subprocess
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
            "jobExecution": False,
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
        },
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
