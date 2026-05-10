# Configuration

All CT-Ops configuration is via environment variables. There are no config files for the web app or ingest service in production — just set env vars in your `.env` file or compose config.

---

## Web Application

🔒 = security-critical. Treat changes to these as you would changes to a password.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✓ 🔒 | — | PostgreSQL connection string (contains credentials) |
| `BETTER_AUTH_SECRET` | ✓ 🔒 | — | Secret used to sign session cookies AND for LDAP bind-password decryption (min 32 chars, never reuse across environments) |
| `BETTER_AUTH_URL` | ✓ 🔒 | — | Public URL of the web app (e.g. `https://ct-ops.corp.example.com`). Use `https://` — `http://` disables cookie Secure flag |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ✓ 🔒 | — | Comma-separated list of allowed origins. Auth flows from origins not in this list are rejected |
| `REQUIRE_EMAIL_VERIFICATION` | — 🔒 | `true` | Require local email/password users to verify their email before sign-in. Set to `false` only when email verification should be optional |
| `CT_OPS_TRUST_PROXY_HEADERS` | — 🔒 | `false` (`true` in the bundled Docker Compose profile) | Trust `X-Forwarded-For` / `X-Real-IP` for client IP rate limits only when a reverse proxy overwrites those headers and direct web-container access is blocked |
| `CT_OPS_LOADTEST_ADMIN_KEY` | — 🔒 | — | Bearer credential for `/api/admin/hosts/bulk-delete`. Endpoint returns 503 when unset. Set only on environments running load tests |
| `NEXT_PUBLIC_APP_URL` | — | — | Exposed to the browser — used for constructing absolute links |
| `NODE_ENV` | — | `development` | Set to `production` in production |
| `AGENT_DIST_DIR` | — | `/var/lib/ct-ops/agent-dist` | Directory where compiled agent binaries are stored for download. If you override or mount it, ensure it is writable by uid/gid `1001` (`nextjs:nodejs`) |
| `AGENT_DOWNLOAD_BASE_URL` | — | `https://localhost` | Public URL agents use to download new binaries. Must be reachable from every agent host |
| `INGEST_WS_URL` | — | *(empty)* | WebSocket URL of the ingest service. Empty = same-origin via the bundled nginx (recommended). Set to an absolute `wss://` URL only to bypass the bundled proxy |
| `WEB_TLS_CERT` | — | `/var/lib/ct-ops/server-tls/server.crt` | Path to the nginx-facing server cert. The enrolment bundle route reads this file and embeds it so agents can verify the HTTPS download URL |
| `CT_CVE_SERVICE_TOKENS` | — 🔒 | *(empty)* | JSON allow-list of signed CT-CVE service tokens that can deliver findings or call CT Ops connection health; use `findings:write` and `connection:read` scopes for the initial inbound connector |
| `CT_CVE_INVENTORY_PUSH_TARGETS` | — 🔒 | *(empty)* | JSON list of outbound CT-CVE inventory targets. Each entry contains `name`, `baseUrl`, and a token object with `id`, `secret`, `ctOpsInstallationId`, and `scopes:["inventory:write"]`; schedule `pnpm --dir apps/web ct-cve:push-inventory` to send snapshots |

### Licence verification

CT-Ops validates licence JWTs using an RSA public key. CT-Ops release builds fetch the current CarrTech verifier key from `carrtech-dev/licence-public-keys`, bake it into the web image, and package it in customer bundles at `./licence-keys/current.pem`. When an admin saves a licence, CT-Ops stores the exact public key that verified that licence and keeps using it for that stored JWT, so future key rotations or image upgrades do not invalidate active licences.

For releases, the public key source of truth is `carrtech-dev/licence-public-keys` at `ct-ops/current.pem`. In an installed customer bundle, it lives at `./licence-keys/current.pem` and is mounted read-only into the web container. Air-gapped installs must upgrade CT-Ops to a release built after any CarrTech key rotation before activating licences purchased after that rotation. The private signing key belongs only in CT Portal.

| Variable | Required | Default | Description |
|---|---|---|---|
| `LICENCE_PUBLIC_KEY_PATH` | — 🔒 | `/var/lib/ct-ops/licence-keys/current.pem` in the customer bundle | Path to the current PEM-encoded RSA public key used for newly activated licence JWTs. If the mounted file is unavailable, CT-Ops falls back to the verifier key baked into the web image. Existing saved licences keep using the verifier key stored with the licence. |
| `LICENCE_PUBLIC_KEY` | — 🔒 | *(baked production key)* | Inline PEM override used only for internal QA/staging or emergency recovery when a file mount is not available. In production, the dev key is explicitly rejected even if supplied here. |
| `LICENCE_REVOCATION_URL` | `https://licence.carrtech.dev/.well-known/ct-ops-licence-revocations.jwt` | same | Signed JWT bundle listing revoked licence ids (`jti`). Connected installs refresh it opportunistically; offline installs fall back to expiry-only validation until the endpoint is reachable again. Set to an empty string to disable remote revocation checks. |

### Example `.env.local` (development)

```env
DATABASE_URL=postgresql://ct-ops:ct-ops@localhost:5432/ct-ops
BETTER_AUTH_SECRET=change-me-to-something-long-and-random-in-production
BETTER_AUTH_URL=https://localhost
BETTER_AUTH_TRUSTED_ORIGINS=https://localhost
REQUIRE_EMAIL_VERIFICATION=true
AGENT_DOWNLOAD_BASE_URL=https://localhost
NEXT_PUBLIC_APP_URL=https://localhost
INGEST_WS_URL=
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
| `INGEST_AGENT_DOWNLOAD_BASE_URL` | — | `https://localhost` | Public URL of the web app — agents construct their binary download URL from this |
| `INGEST_TERMINAL_TRUSTED_ORIGINS` | — 🔒 | *(empty)* | Comma-separated browser origins allowed to open terminal WebSockets directly against ingest. Leave empty to require same-origin proxying |
| `INGEST_WEB_SERVER_CERT` | — | `/etc/ct-ops/server-tls/server.crt` | Path to the nginx-facing server cert. Ingest reads this and pushes rotations down the heartbeat stream when an operator swaps the cert, so agents keep verifying download URLs without manual CA distribution. Empty disables the rotation RPC |

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
# Enrolment token from Administration → Agents → Enrolment
# Can also be set via CT_OPS_ENROLMENT_TOKEN env var
enrolment_token = "tok_..."

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
| `CT_OPS_ENROLMENT_TOKEN` | `agent.enrolment_token` |
| `CT_OPS_DATA_DIR` | `agent.data_dir` |

---

## Ports Summary

Public ports (bound to all interfaces):

| Service | Port | Protocol | Purpose |
|---|---|---|---|
| nginx | 443 | HTTPS | Browser traffic — TLS termination |
| nginx | 80 | HTTP | Redirect to :443 |
| Ingest | 9443 | gRPC + mTLS | Agent connections (bypasses nginx) |

Loopback-only ports (reachable from the host over SSH tunnels only):

| Service | Port | Protocol | Purpose |
|---|---|---|---|
| Web | 3000 | HTTP | Next.js — fronted by nginx |
| Ingest | 8080 | HTTP | JWKS, `/healthz`, WebSocket terminal — fronted by nginx |
| PostgreSQL | 5432 | TCP | Database |

Override the nginx port bindings with `NGINX_HTTPS_PORT` and `NGINX_HTTP_PORT` in `.env` if 443/80 are already in use.
