---
sidebar_position: 2
---

# Agent Architecture

The Infrawatch agent is a statically compiled Go binary. It has no runtime dependencies — just copy the binary to a host and run it. It is designed to work in fully air-gapped environments.

---

## Overview

```
Agent                    Ingest Service          PostgreSQL
  │                            │                     │
  │── Register(token, key) ───►│                     │
  │                            │── insert host ─────►│
  │◄── agent_id, pending ──────│                     │
  │                            │                     │
  │  (polls every 30s)         │                     │
  │── GetStatus(agent_id) ────►│                     │
  │◄── status=active, jwt ─────│                     │
  │                            │                     │
  │  save agent_state.json     │                     │
  │                            │                     │
  │══ Heartbeat stream ════════►│                     │
  │   cpu/mem/disk/uptime      │── update vitals ───►│
  │◄══════════════════════════ │                     │
```

---

## Registration Flow

### First run (no `agent_state.json`)

1. Agent generates an Ed25519 keypair on the host and persists it to `data_dir`
2. Sends a `Register` RPC with the org enrolment token and public key
3. Ingest validates the token, inserts a host record, and returns `agent_id` + status
4. If **auto-approve** is enabled on the token: status is `active` immediately
5. If not: status is `pending` — the agent polls every 30 seconds until an admin approves it in the UI
6. On approval: agent receives a signed JWT, saves it to `agent_state.json`, and starts the heartbeat stream

### Restart (existing `agent_state.json`)

If `agent_state.json` exists and the JWT is not expired (24 h TTL), the agent skips registration entirely and goes straight to the heartbeat stream.

If the JWT is expired, it calls `Register` again to get a fresh one.

**Registration is idempotent** — re-registering the same keypair returns the same `agent_id`.

---

## Identity Model

Three files are stored in `data_dir`:

| File | Contents | Notes |
|---|---|---|
| `agent_key.pem` | Ed25519 private key (PEM) | Never leaves the host |
| `agent_key.pub` | Ed25519 public key (PEM) | Sent to ingest at registration |
| `agent_state.json` | `agent_id` + JWT | Written after approval |

**Deleting only `agent_state.json`** forces re-registration — the agent will use the same keypair (same identity) but get a new JWT.

**Deleting the entire `data_dir`** forces complete re-registration as a new host — a new keypair is generated and a new host record is created.

---

## Heartbeat Stream

The heartbeat is a bidirectional gRPC streaming RPC. The agent sends a payload every `heartbeat_interval_secs` seconds:

```protobuf
message HeartbeatRequest {
  string agent_id = 1;
  float  cpu_percent    = 2;
  float  memory_percent = 3;
  float  disk_percent   = 4;
  int64  uptime_seconds = 5;
  int64  timestamp_unix = 6;
}
```

The server marks the host **Offline** if the stream closes or no heartbeat is received within 2× the configured interval. On reconnect, the host returns to **Online** on the next heartbeat.

The bidirectional design allows the server to push commands back to the agent (used for task execution and config reload).

### Reconnection

The agent uses exponential backoff on disconnect:

```
1s → 2s → 4s → 8s → 16s → 32s → 60s (capped)
```

---

## Configuration

```toml
[ingest]
# Address of the ingest service (host:port)
address = "ingest.corp.example.com:9443"

# Optional: path to CA cert for self-signed or corporate TLS
# Leave empty if using a publicly trusted certificate
ca_cert_file = "/etc/infrawatch/ca.crt"

[agent]
org_token = "tok_..."          # or INFRAWATCH_ORG_TOKEN env var
data_dir  = "/var/lib/infrawatch/agent"
version   = "0.1.0"
heartbeat_interval_secs = 30
```

### Environment variable overrides

| Variable | Overrides |
|---|---|
| `INFRAWATCH_INGEST_ADDRESS` | `ingest.address` |
| `INFRAWATCH_INGEST_CA_CERT` | `ingest.ca_cert_file` |
| `INFRAWATCH_ORG_TOKEN` | `agent.org_token` |
| `INFRAWATCH_DATA_DIR` | `agent.data_dir` |

---

## Running as a systemd Service

```ini title="/etc/systemd/system/infrawatch-agent.service"
[Unit]
Description=Infrawatch Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/infrawatch-agent -config /etc/infrawatch/agent.toml
Restart=on-failure
RestartSec=5
User=infrawatch
Group=infrawatch

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now infrawatch-agent
journalctl -u infrawatch-agent -f
```

---

## Log Output

The agent logs structured text to stdout:

```
level=INFO msg="agent identity ready" data_dir=/var/lib/infrawatch/agent
level=INFO msg="registering agent" address=ingest.corp.example.com:9443
level=INFO msg="registration response" status=active agent_id=clxyz123...
level=INFO msg="agent registered and active"
level=INFO msg="starting heartbeat" interval_secs=30
level=INFO msg="heartbeat stream opened"
```

---

## Uninstalling an Agent

1. Stop the agent process (or `systemctl stop infrawatch-agent`)
2. The host transitions to **Offline** in the UI automatically
3. Optionally revoke the enrolment token in **Settings → Agent Enrolment**
4. Delete the data directory: `rm -rf /var/lib/infrawatch/agent`

The host record remains in Infrawatch's database (soft-deleted on revocation). You can remove it from the Hosts UI.

---

## Self-Update

The agent polls the ingest service for the minimum required version. If the running version is below the minimum:

1. Agent downloads the signed binary from the web server (`INGEST_AGENT_DOWNLOAD_BASE_URL`)
2. Verifies the signature
3. Hot-swaps the binary and restarts
4. Rolls back automatically on failure

All updates are served from your Infrawatch server — no internet access required.
