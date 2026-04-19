# Configuration

All CT-Ops configuration is via environment variables. There are no config files for the web app or ingest service in production — just set env vars in your `.env` file or compose config.

---

## Web Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | ✓ | — | Secret key for signing sessions (min 32 chars, keep private) |
| `BETTER_AUTH_URL` | ✓ | — | Public URL of the web app (e.g. `https://ct-ops.corp.example.com`) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | — | Same as `BETTER_AUTH_URL` | Comma-separated list of allowed origins for CORS |
| `LICENCE_PUBLIC_KEY` | ✓ (prod) | dev key | RSA public key PEM for validating licence JWTs. **Required in production** — the server refuses to start without it. See below. |
| `NEXT_PUBLIC_APP_URL` | — | — | Exposed to the browser — used for constructing absolute links |
| `NODE_ENV` | — | `development` | Set to `production` in production |
| `AGENT_DIST_DIR` | — | `/var/lib/ct-ops/agent-dist` | Directory where compiled agent binaries are stored for download |
| `INGEST_WS_URL` | — | `ws://localhost:8080` | WebSocket URL of the ingest service (for real-time agent status) |

### Licence public key

CT-Ops validates licence JWTs using an RSA public key. In development this falls back to a built-in dev key. In **production** you must supply your own:

```bash
# Generate a key pair (keep the private key safe — it signs licence tokens)
openssl genrsa -out licence-private.pem 2048
openssl rsa -in licence-private.pem -pubout -out licence-public.pem
```

Set `LICENCE_PUBLIC_KEY` to the contents of `licence-public.pem`. The server will refuse to start in production if the variable is absent or still set to the development key.

### Example `.env.local` (development)

```env
DATABASE_URL=postgresql://ct-ops:ct-ops@localhost:5432/ct-ops
BETTER_AUTH_SECRET=change-me-to-something-long-and-random-in-production
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
INGEST_WS_URL=ws://localhost:8080
```

---

## Ingest Service

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `INGEST_TLS_CERT` | ✓ | — | Path to TLS certificate file (PEM) |
| `INGEST_TLS_KEY` | ✓ | — | Path to TLS private key file (PEM) |
| `INGEST_JWT_KEY_FILE` | — | `/var/lib/ct-ops/jwt_key.pem` | Path to RSA private key for JWT signing (auto-generated if missing) |
| `INGEST_GRPC_PORT` | — | `9443` | gRPC listener port |
| `INGEST_HTTP_PORT` | — | `8080` | HTTP port for JWKS endpoint and health check |
| `INGEST_AGENT_DOWNLOAD_BASE_URL` | — | `http://localhost:3000` | Public URL of the web app — agents construct their binary download URL from this |

:::warning JWT Key Backup
Back up `INGEST_JWT_KEY_FILE`. Losing it invalidates all existing agent JWTs and forces every agent to re-register.
:::

---

## Agent

The agent is configured via a TOML file. The path is passed with the `-config` flag.

```toml
[ingest]
# Address of the ingest service (host:port)
address = "ingest.corp.example.com:9443"

# Optional: path to CA cert for self-signed/corporate TLS
# Leave empty if ingest uses a publicly trusted certificate
ca_cert_file = "/etc/ct-ops/ca.crt"

[agent]
# Enrolment token from Settings → Agent Enrolment
# Can also be set via CT_OPS_ORG_TOKEN env var
org_token = "tok_..."

# Directory where agent stores its identity (keypair + JWT)
data_dir = "/var/lib/ct-ops/agent"

# Agent version string (set by build system)
version = "0.1.0"

# How often to send heartbeat (seconds)
heartbeat_interval_secs = 30
```

### Environment variable overrides

All TOML values can be overridden via environment variables:

| Environment variable | TOML path |
|---|---|
| `CT_OPS_INGEST_ADDRESS` | `ingest.address` |
| `CT_OPS_INGEST_CA_CERT` | `ingest.ca_cert_file` |
| `CT_OPS_ORG_TOKEN` | `agent.org_token` |
| `CT_OPS_DATA_DIR` | `agent.data_dir` |

---

## Ports Summary

| Service | Port | Protocol | Purpose |
|---|---|---|---|
| Web | 3000 | HTTP/HTTPS | Web UI |
| Ingest | 9443 | gRPC over TLS | Agent connections |
| Ingest | 8080 | HTTP | JWKS endpoint, `/healthz` |
| PostgreSQL | 5432 | TCP | Database |
