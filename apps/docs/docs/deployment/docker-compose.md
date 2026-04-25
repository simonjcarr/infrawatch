# Docker Compose Deployment

The recommended way to run CT-Ops in production is via `docker-compose.single.yml`. This deploys the full stack (web, ingest, database) on a single host using pre-built images from GHCR.

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
AGENT_DOWNLOAD_BASE_URL=https://ct-ops.example.com
EOF
```

:::danger
Change `BETTER_AUTH_SECRET` before going to production. Use at least 32 random characters.
:::

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
| `nginx` | `nginx:1.27-alpine` | **443**, **80** | TLS terminator for browser traffic |
| `db` | `timescale/timescaledb:latest-pg16` | 127.0.0.1:5432 | PostgreSQL + TimescaleDB |
| `web` | `ghcr.io/carrtech-dev/ct-ops/web:latest` | 127.0.0.1:3000 | Next.js web app (reached via nginx) |
| `ingest` | `ghcr.io/carrtech-dev/ct-ops/ingest:latest` | **9443**, 127.0.0.1:8080 | Agent gRPC (:9443 direct, bypasses nginx) + JWKS on loopback |

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

To update to the latest image versions:

```bash
docker compose -f docker-compose.single.yml pull
docker compose -f docker-compose.single.yml up -d
```

Migrations run automatically on container start.

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

No rebuild is required. On the next heartbeat, every connected agent's pinned fingerprint will mismatch the new cert, and the ingest service pushes the new cert down the mTLS-protected heartbeat stream. The agent persists it to its data dir and uses it as an additional trust anchor for self-update downloads. This means operators can rotate the browser cert without touching any agent host, even on Linux VMs where the internal CA is not installed in the system trust store.

## Fronting with your own reverse proxy

If you prefer to use an existing load balancer or TLS terminator (e.g. a corporate HAProxy, an F5, or Cloudflare Tunnel), stop the bundled nginx and point your proxy at `127.0.0.1:3000` (web) and `127.0.0.1:8080` (ingest WebSocket terminal). Leave port 9443 as a straight passthrough — agent mTLS must not be terminated. Update `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, and `AGENT_DOWNLOAD_BASE_URL` to match the URL your proxy serves.
