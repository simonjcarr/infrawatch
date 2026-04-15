---
sidebar_position: 1
---

# Docker Compose Deployment

The recommended way to run Infrawatch in production is via `docker-compose.single.yml`. This deploys the full stack (web, ingest, database) on a single host using pre-built images from GHCR.

---

## Prerequisites

- Docker Engine 24.x or later
- Docker Compose v2.x (bundled with Docker Desktop)
- A server with at least 2 GB RAM and 10 GB disk

---

## Quick Deploy (GHCR images)

```bash
# Download the deployment bundle
curl -fsSL https://raw.githubusercontent.com/simonjcarr/infrawatch/main/install.sh | bash
cd infrawatch

# First run: creates .env with defaults, then exits
./start.sh

# Edit the environment file
nano .env

# Second run: generates certs, starts all services
./start.sh
```

When `docker compose ps` shows all containers as `healthy`, open the web UI at `http://<your-server>:3000`.

---

## Manual Deploy

If you prefer to manage the deployment yourself:

### 1. Create a directory and download the compose file

```bash
mkdir infrawatch && cd infrawatch
curl -fsSL https://github.com/simonjcarr/infrawatch/releases/latest/download/docker-compose.single.yml \
  -o docker-compose.single.yml
```

### 2. Create the environment file

```bash
# Minimum required variables
cat > .env <<'EOF'
POSTGRES_USER=infrawatch
POSTGRES_PASSWORD=change-me
POSTGRES_DB=infrawatch
BETTER_AUTH_SECRET=change-me-to-a-long-random-string
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
EOF
```

:::danger
Change `BETTER_AUTH_SECRET` before going to production. Use at least 32 random characters.
:::

### 3. Generate TLS certificates for the ingest service

```bash
mkdir -p deploy/dev-tls
openssl req -x509 -newkey rsa:4096 -keyout deploy/dev-tls/server.key \
  -out deploy/dev-tls/server.crt -days 365 -nodes \
  -subj "/CN=infrawatch-ingest"
```

For production, use a certificate from your corporate CA or Let's Encrypt.

### 4. Start the stack

```bash
docker compose -f docker-compose.single.yml up -d
```

### 5. Watch startup logs

```bash
docker compose -f docker-compose.single.yml logs -f web
```

The web container runs database migrations automatically on first start. Once you see `Ready on http://0.0.0.0:3000`, the stack is up.

---

## Services

| Service | Image | Port(s) | Description |
|---|---|---|---|
| `db` | `timescale/timescaledb:latest-pg16` | 5432 | PostgreSQL + TimescaleDB |
| `web` | `ghcr.io/simonjcarr/infrawatch/web:latest` | 3000 | Next.js web app |
| `ingest` | `ghcr.io/simonjcarr/infrawatch/ingest:latest` | 9443, 8080 | gRPC ingest + JWKS |

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
  pg_dump -U infrawatch infrawatch > backup-$(date +%Y%m%d).sql

# JWT key backup (losing this forces all agents to re-register)
docker compose -f docker-compose.single.yml cp \
  ingest:/var/lib/infrawatch/jwt_key.pem ./jwt_key.pem.bak
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

## Reverse Proxy

To expose the web UI on port 443 with TLS termination, add nginx or Caddy in front:

```nginx title="nginx.conf (example)"
server {
    listen 443 ssl;
    server_name infrawatch.corp.example.com;

    ssl_certificate     /etc/ssl/infrawatch.crt;
    ssl_certificate_key /etc/ssl/infrawatch.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Update `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` in `.env` to reflect the public HTTPS URL.
