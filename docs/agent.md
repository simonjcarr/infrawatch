# Agent

The CT-Ops agent is a small Go binary that runs on each host you want to monitor. It connects to the ingest service over gRPC (TLS), registers itself, and sends periodic heartbeats with system vitals.

It has no runtime dependencies, produces a single static binary, and is designed to run in fully air-gapped environments.

---

## How it works

```
Agent                         Ingest Service               Database
  │                                │                           │
  ├─ generate Ed25519 keypair       │                           │
  ├─ load/create agent state        │                           │
  │                                │                           │
  ├── Register(org_token, pubkey) ──►                           │
  │                                ├── validate enrolment token─►
  │                                ├── insert agent (pending) ──►
  │◄─ {agent_id, status:"pending"} ─┤                           │
  │                                │                           │
  ├─ poll every 30s ───────────────►                           │
  │                                │    (admin approves in UI) │
  │◄─ {agent_id, status:"active",  ─┤                           │
  │    jwt_token}                  │                           │
  │                                │                           │
  ├─ save agent_id + JWT to disk   │                           │
  │                                │                           │
  ├── Heartbeat stream ────────────►                           │
  │   {cpu%, mem%, disk%, uptime}  ├── update host vitals ─────►
  │◄─ {ok: true} ──────────────────┤                           │
  │   (every 30s)                  │                           │
```

**Registration is idempotent** — if the agent restarts with an existing `agent_state.json`, it uses the stored JWT and goes straight to the heartbeat stream without re-registering.

---

## Installation

### Build from source

```bash
# From the repo root
make agent
# Binary at: dist/agent
```

Or build directly:

```bash
go build -o dist/agent ./agent/cmd/agent
```

### Running as a service (systemd)

Create `/etc/systemd/system/ct-ops-agent.service`:

```ini
[Unit]
Description=CT-Ops Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/ct-ops-agent -config /etc/ct-ops/agent.toml
Restart=on-failure
RestartSec=10
User=ct-ops
Group=ct-ops

[Install]
WantedBy=multi-user.target
```

Then:

```bash
systemctl enable --now ct-ops-agent
```

---

## Configuration

The agent reads a TOML file (default: `/etc/ct-ops/agent.toml`). Pass a different path with the `-config` flag:

```bash
ct-ops-agent -config /path/to/agent.toml
```

### Full config reference

```toml
[ingest]
# Address of the CT-Ops ingest service.
# Format: host:port
address = "ct-ops.yourdomain.com:9443"

# Path to the server's CA certificate PEM file.
# Required when using a self-signed or private CA certificate.
# Leave empty to use the system's default CA bundle (recommended for production
# with a certificate from a public CA or your corporate PKI).
ca_cert_file = ""


[agent]
# Enrolment token from the CT-Ops UI (Administration → Agents → Enrolment).
# Can also be set via the CT_OPS_ORG_TOKEN environment variable.
org_token = ""

# Directory where the agent stores its identity.
# Contains: agent_key.pem, agent_key.pub, agent_state.json
# Must be readable/writable by the agent process.
data_dir = "/var/lib/ct-ops/agent"

# Agent binary version string.
version = "0.1.0"

# How often to send a heartbeat to the ingest service.
# Lower values mean more up-to-date status in the UI but more network traffic.
heartbeat_interval_secs = 30
```

### Environment variable overrides

All config values can be overridden with environment variables. Useful for containers or secret injection.

| Environment variable | Config equivalent |
|---|---|
| `CT_OPS_INGEST_ADDRESS` | `ingest.address` |
| `CT_OPS_INGEST_CA_CERT` | `ingest.ca_cert_file` |
| `CT_OPS_ORG_TOKEN` | `agent.org_token` |
| `CT_OPS_DATA_DIR` | `agent.data_dir` |

Example:

```bash
CT_OPS_ORG_TOKEN=abc123 \
CT_OPS_INGEST_ADDRESS=ingest.internal:9443 \
ct-ops-agent -config /etc/ct-ops/agent.toml
```

---

## Identity and data directory

The agent generates and persists its identity on first run. The data directory contains three files:

| File | Contents | Notes |
|---|---|---|
| `agent_key.pub` | Ed25519 public key (PEM) | Sent to server at registration. Uniquely identifies this agent. |
| `agent_key.pem` | Ed25519 private key (PEM) | Never leaves the host. Used for future mTLS. |
| `agent_state.json` | Agent ID + JWT | Written after successful approval. Allows the agent to skip re-registration on restart. |

**Do not delete the data directory** unless you intend to re-register the agent as a new host. Deleting `agent_state.json` alone forces re-registration (the server will return the existing agent ID since the public key matches).

---

## Registration flow

When the agent starts for the first time (no `agent_state.json`):

1. Sends `Register` RPC with the org token and its Ed25519 public key
2. Server validates the token and inserts an `agents` row
3. If the token has **auto-approve** enabled → server sets status to `active` and returns a JWT immediately
4. If not → server returns `status: "pending"`; agent polls every 30 seconds
5. Once an admin approves the agent in the UI, the next poll returns `status: "active"` with a JWT
6. Agent saves `{agent_id, jwt_token}` to `agent_state.json` and starts the heartbeat stream

**Re-registration (after restart):**
- If `agent_state.json` exists and contains a JWT → agent skips `Register` and goes straight to `Heartbeat`
- If the JWT has expired (24h TTL) → agent calls `Register` again; server returns a fresh JWT

---

## Heartbeat stream

The heartbeat is a **bidirectional gRPC stream**. The agent sends a `HeartbeatRequest` on each interval; the server responds immediately with `HeartbeatResponse`.

The bidirectional design allows the server to push commands back to the agent without the agent polling (used in a future session for things like config reload or revocation).

**What gets sent:**

| Field | Description |
|---|---|
| `agent_id` | The agent's ID (from registration) |
| `cpu_percent` | Current CPU usage (0–100) |
| `memory_percent` | RAM used / total RAM (0–100) |
| `disk_percent` | Disk used / total on `/` (0–100) |
| `uptime_seconds` | Seconds since last boot |
| `timestamp_unix` | Unix timestamp of measurement |

**On disconnect:** the ingest service marks the agent and host as `offline`. When the agent reconnects, status returns to `online` on the next heartbeat.

**Reconnection:** if the stream drops, the agent reconnects automatically with exponential backoff (1s → 2s → 4s → … up to 60s).

---

## Logs

The agent logs to stdout in a structured text format:

```
time=2026-03-28T10:00:00Z level=INFO msg="agent identity ready" data_dir=/var/lib/ct-ops/agent
time=2026-03-28T10:00:00Z level=INFO msg="registering agent" address=ct-ops.internal:9443
time=2026-03-28T10:00:01Z level=INFO msg="registration response" status=pending agent_id=abc123
time=2026-03-28T10:00:01Z level=INFO msg="agent pending approval, polling" interval=30s
time=2026-03-28T10:00:31Z level=INFO msg="registration response" status=active agent_id=abc123
time=2026-03-28T10:00:31Z level=INFO msg="agent registered and active" agent_id=abc123
time=2026-03-28T10:00:31Z level=INFO msg="starting heartbeat" interval_secs=30
time=2026-03-28T10:00:31Z level=INFO msg="heartbeat stream opened" agent_id=abc123
```

For systemd, logs are available via `journalctl -u ct-ops-agent -f`.

---

## Uninstalling an agent

To fully remove an agent:

1. Stop the agent process
2. In the CT-Ops UI, go to **Hosts** and find the host — it will show as `Offline`
3. To prevent it from re-registering, revoke its enrolment token in **Administration → Agents → Enrolment** (if no other agents use that token)
4. Delete the data directory on the host: `rm -rf /var/lib/ct-ops/agent`
