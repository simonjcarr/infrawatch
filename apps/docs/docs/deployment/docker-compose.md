# Docker Compose Deployment

The recommended way to run CT-Ops in production is via `docker-compose.single.yml`. This deploys the full stack (web, ingest, database, and the bundled Password Manager services) on a single host using digest-pinned images from GHCR.

---

## Prerequisites

- Docker Engine 24.x or later
- Docker Compose v2.x (bundled with Docker Desktop)
- A server with at least 2 GB RAM and 10 GB disk

---

## Quick Deploy (GHCR images)

```bash
# Download the deployment bundle
curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
cd ct-ops

# First run: creates .env with defaults, then exits
./start.sh

# Edit the environment file
nano .env

# Second run: generates certs, starts all services
./start.sh
```

When `docker compose ps` shows all containers as `healthy`, open the web UI at `https://<your-server>`. The bundle ships a self-signed certificate — your browser will warn on first visit. To replace it with a certificate from your own CA, see [Replacing the TLS certificate](#replacing-the-tls-certificate) below.

If you need to open a support request, run `./generate_support_data` from the
bundle directory. It creates `ct-ops-support-data-<timestamp>.tar.gz` next to
`docker-compose.yml` with sanitized settings, Docker status, recent logs, host
information, file metadata, and TLS certificate fingerprints. Raw `.env` files,
private keys, and database dumps are not included; review the archive before
attaching it to a ticket.

If ports 80 or 443 are already in use on the host, set `NGINX_HTTP_PORT` and
`NGINX_HTTPS_PORT` in `.env` before the second `./start.sh` run. Include the
external HTTPS port in `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, and
`AGENT_DOWNLOAD_BASE_URL`, for example `https://ct-ops.example.com:8443`.

---

## Manual Deploy

If you prefer to manage the deployment yourself:

### 1. Create a directory and download the compose file

```bash
mkdir ct-ops && cd ct-ops
curl -fsSL https://github.com/carrtech-dev/ct-ops/releases/latest/download/docker-compose.single.yml \
  -o docker-compose.single.yml
```

### 2. Create the environment file

```bash
# Minimum required variables
cat > .env <<'EOF'
POSTGRES_USER=ct-ops
POSTGRES_PASSWORD=change-me
POSTGRES_DB=ct-ops
BETTER_AUTH_SECRET=change-me-to-a-long-random-string
BETTER_AUTH_URL=https://ct-ops.example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://ct-ops.example.com
REQUIRE_EMAIL_VERIFICATION=true
AGENT_DOWNLOAD_BASE_URL=https://ct-ops.example.com
EOF
```

:::danger
Change `BETTER_AUTH_SECRET` before going to production. Use at least 32 random characters.
:::

`REQUIRE_EMAIL_VERIFICATION` defaults to `true` when unset, which requires local email/password users to verify their email before sign-in. Set it to `false` only for deployments where unverified local accounts should be allowed to continue into CT-Ops.

### 3. Generate TLS certificates

`start.sh` generates two self-signed certificates on first run:

| Purpose | Path | Consumed by |
|---|---|---|
| Agent gRPC (mTLS on :9443) | `deploy/dev-tls/server.{crt,key}` | ingest container |
| Browser HTTPS (:443) | `deploy/tls/server.{crt,key}` | bundled nginx container |

Both certs are RSA 4096-bit with a 365-day lifetime and SANs for `localhost`, the docker-internal hostname, and every non-loopback IPv4 the host is currently using. Short expiry is deliberate — if you forget to rotate, the stack fails loudly within a year. If you are deploying manually, run `./deploy/scripts/gen-server-cert.sh` with `OUT_DIR=deploy/tls` and again with `OUT_DIR=deploy/dev-tls` `CN=ct-ops-ingest` before `docker compose up`.

For production, replace the generated cert files with ones from your own CA — see [Replacing the TLS certificate](#replacing-the-tls-certificate). Re-running `start.sh` will not overwrite certificates that already exist on disk.

### 4. Start the stack

```bash
docker compose -f docker-compose.single.yml up -d
```

### 5. Watch startup logs

```bash
docker compose -f docker-compose.single.yml logs -f web
```

The one-shot `migrate` container applies database migrations before web and ingest start. Once you see `Ready on http://0.0.0.0:3000`, the stack is up.

---

## Services

| Service | Image | Host ports | Description |
|---|---|---|---|
| `nginx` | `nginx@sha256:...` | **443**, **80** | TLS terminator for browser traffic |
| `db` | `timescale/timescaledb@sha256:...` | 127.0.0.1:5432 | PostgreSQL + TimescaleDB |
| `password-manager-db` | `postgres@sha256:...` | none | Bundled CT Password Manager PostgreSQL database on the internal compose network |
| `password-manager-migrate` | `ghcr.io/carrtech-dev/ct-password-manager/api@sha256:...` | none | One-shot Password Manager migration job that must finish before the API starts |
| `password-manager-api` | `ghcr.io/carrtech-dev/ct-password-manager/api@sha256:...` | none | Bundled CT Password Manager API, reverse proxied by CT-Ops at `/password-manager-api/` |
| `web` | `ghcr.io/carrtech-dev/ct-ops/web@sha256:...` | 127.0.0.1:3000 | Next.js web app (reached via nginx) |
| `ingest` | `ghcr.io/carrtech-dev/ct-ops/ingest@sha256:...` | **9443**, 127.0.0.1:8080 | Agent gRPC (:9443 direct, bypasses nginx) + JWKS on loopback |

Only `443`, `80`, and `9443` are published on all host interfaces:

- `443` / `80` — browser traffic (nginx terminates TLS; `80` redirects to `443`).
- `9443` — agent gRPC with mTLS. Agents connect direct to the ingest container; the proxy is intentionally skipped so client-cert verification is never terminated mid-hop.

The remaining ports are bound to `127.0.0.1` only, so `web:3000`, `ingest:8080`, and Postgres are reachable from the host (for debugging over SSH tunnels) but not from the network. Override the nginx ports with `NGINX_HTTPS_PORT` / `NGINX_HTTP_PORT` in `.env` if 80/443 are already in use.

When installing inside a VM, LXC, or Incus instance that sits behind a NAT or
private bridge, forward the external HTTPS port and `9443` to the instance.
Agents must be able to reach `AGENT_DOWNLOAD_BASE_URL` and `host:9443` from
their own network, not just from the container host.

---

## Updating

To update to newer image versions:

```bash
docker compose -f docker-compose.single.yml pull
docker compose -f docker-compose.single.yml up -d
```

Migrations run automatically on container start. Release bundles ship with digest-pinned `WEB_IMAGE` and `INGEST_IMAGE` values in `.env.example`; when a new CT-Ops release is published, update both values to the new release digests before pulling.

Password Manager compatibility is tracked separately in
`deploy/password-manager-release.json`. That descriptor records the reviewed CT
Password Manager API digest, source commit, contract version, and contract
checksum that the current CT-Ops line is expected to integrate with. Bump it in
the same CT-Ops pull request that validates compatibility against the selected
Password Manager release; do not treat it as an operator override.

Release bundles embed that digest-pinned reference directly in compose for both
`password-manager-migrate` and `password-manager-api`. Operators should not set
`PASSWORD_MANAGER_API_IMAGE`; upgrades remove that legacy override so the
bundled UI and API stay aligned with the reviewed descriptor.

---

## Backups

Back up the PostgreSQL database and the ingest JWT key:

```bash
# Database backup
docker compose -f docker-compose.single.yml exec db \
  pg_dump -U ct-ops ct-ops > backup-$(date +%Y%m%d).sql

# JWT key backup (losing this forces all agents to re-register)
docker compose -f docker-compose.single.yml cp \
  ingest:/var/lib/ct-ops/jwt_key.pem ./jwt_key.pem.bak
```

If you use the bundled Password Manager, also keep these restore inputs
together:

- the `password_manager_db_data` Docker volume
- the deployment `.env` file, which stores the generated Password Manager
  bootstrap secrets and launch-signing keys
- `deploy/password-manager-release.json`, which records the reviewed Password
  Manager image digest and API contract metadata

On host-level restore, restore those three artifacts alongside the main CT-Ops
database backup before restarting the stack.

---

## Stopping

```bash
# Stop containers (keep data)
docker compose -f docker-compose.single.yml down

# Stop and wipe all data (destructive!)
docker compose -f docker-compose.single.yml down -v
```

---

## Replacing the TLS certificate

The bundled nginx serves `deploy/tls/server.crt` + `deploy/tls/server.key` on port 443. To replace the self-signed cert with one from your own CA:

```bash
# Copy your cert and key into place (overwrite the auto-generated files).
install -m 0644 /path/to/your.crt deploy/tls/server.crt
install -m 0600 /path/to/your.key deploy/tls/server.key

# Restart only the nginx container — web, ingest, and agents keep running.
docker compose restart nginx
```

No rebuild is required. On the next heartbeat, every connected agent's pinned fingerprint will mismatch the new cert, and the ingest service pushes the new cert down the mTLS-protected heartbeat stream. The agent persists it to its data dir so the latest trust material stays aligned across restarts while signed self-update support is reworked. This means operators can rotate the browser cert without touching any agent host, even on Linux VMs where the internal CA is not installed in the system trust store.

## Fronting with your own reverse proxy

If you prefer to use an existing load balancer or TLS terminator (e.g. a corporate HAProxy, an F5, or Cloudflare Tunnel), stop the bundled nginx and point your proxy at `127.0.0.1:3000` (web) and `127.0.0.1:8080` (ingest WebSocket terminal). Leave port 9443 as a straight passthrough — agent mTLS must not be terminated. Update `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, and `AGENT_DOWNLOAD_BASE_URL` to match the URL your proxy serves. Set `CT_OPS_TRUST_PROXY_HEADERS=true` only if that proxy overwrites client-supplied `X-Forwarded-For` / `X-Real-IP` headers and prevents direct access to the web container.
