# Installation

This guide walks you through getting Infrawatch running — from zero to a real agent showing up as online in the host inventory.

There are two ways to run Infrawatch:

- **[Option A — Pre-built images from GHCR](#option-a--pre-built-images-from-ghcr)** — Fastest. No clone required, just a `docker-compose.yml` and an env file.
- **[Option B — Build from source](#option-b--build-from-source)** — For development or if you want to modify the code.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker + Docker Compose | v2.x | Runs the full stack and all build steps |

That's it. No local Go, Node.js, or pnpm required.

---

## Option A — Pre-built images from GHCR

The fastest way to get Infrawatch running. One command downloads a small bundle (compose file, `start.sh`, `.env.example`) from the latest GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
cd infrawatch
./start.sh        # first run: creates .env from the example, then exits
$EDITOR .env      # set BETTER_AUTH_URL, AGENT_DOWNLOAD_BASE_URL, etc.
./start.sh        # second run: generates secret, certs, pulls images, boots
```

To pin a specific version:

```bash
INFRAWATCH_VERSION=v0.3.0 curl -fsSL ... | bash
```

`start.sh` generates dev TLS certs, generates `BETTER_AUTH_SECRET` if blank, pulls images from GHCR, and starts the stack. Database migrations run inside the web container automatically on startup.

When all three containers show `healthy` in `docker compose ps`, continue to [Create your account](#create-your-account).

---

## Option B — Build from source

### 1. Clone the repository

```bash
git clone https://github.com/carrtech-dev/ct-ops infrawatch
cd infrawatch
```

### 2. Generate dev TLS certificates

```bash
make dev-tls
```

This creates `deploy/dev-tls/server.crt` and `deploy/dev-tls/server.key`. These files are gitignored — regenerate them after a clean checkout.

### 3. Configure environment variables

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` and set at minimum:

```env
DATABASE_URL=postgresql://infrawatch:infrawatch@localhost:5432/infrawatch
BETTER_AUTH_SECRET=a-long-random-string-change-this
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Start the stack

```bash
docker compose -f docker-compose.single.yml up -d
```

This starts:
- **`db`** — PostgreSQL + TimescaleDB on port 5432
- **`web`** — Next.js web UI on port 3000
- **`ingest`** — gRPC ingest service on port 9443, JWKS/healthz on port 8080

### 5. Run database migrations

```bash
docker compose -f docker-compose.single.yml exec web sh -c "cd /app && node_modules/.bin/drizzle-kit migrate"
```

---

## Create your account

Open [http://localhost:3000](http://localhost:3000) in a browser.

1. Click **Register** and create your account
2. Complete the **onboarding wizard** — enter your organisation name and click **Create Organisation**
3. You're now logged in as `super_admin`

---

## Create an enrolment token

An enrolment token is what the agent uses to register itself with your organisation.

1. In the sidebar, click **Settings → Agent Enrolment**
2. Click **New Token**
3. Give it a label (e.g. `dev-servers`)
4. Tick **Auto-approve agents** for development — this skips the manual approval step
5. Click **Create Token**
6. **Copy the token now** — it won't be shown in full again

> Installing on an air-gapped host? See [Offline Agent Install Bundle](./agent-install-bundle.md) to download a portable zip with the binary, install script, and config.

---

## Build and run the agent

```bash
make agent
```

Copy the example config:

```bash
cp agent/examples/agent.toml /tmp/agent.toml
```

Edit `/tmp/agent.toml`:

```toml
[ingest]
address = "localhost:9443"
ca_cert_file = "deploy/dev-tls/server.crt"

[agent]
org_token = "YOUR_ENROLMENT_TOKEN"
data_dir = "/tmp/infrawatch-agent"
version = "0.1.0"
heartbeat_interval_secs = 30
```

Run it:

```bash
./dist/agent -config /tmp/agent.toml
```

Expected output:

```
level=INFO msg="agent identity ready" data_dir=/tmp/infrawatch-agent
level=INFO msg="registering agent" address=localhost:9443
level=INFO msg="registration response" status=active agent_id=abc123...
level=INFO msg="starting heartbeat" interval_secs=30
level=INFO msg="heartbeat stream opened"
```

---

## Verify in the UI

Open [http://localhost:3000/hosts](http://localhost:3000/hosts). Your host should appear with a green **Online** badge.

If you did **not** use auto-approve, the agent appears in the **Pending Approval** panel at the top of the Hosts page. Click **Approve** — the agent receives a JWT within 30 seconds and begins heartbeating.

---

## Stopping

Stop the agent with `Ctrl+C`. The host transitions to **Offline** immediately.

```bash
# Stop the stack (keep data)
docker compose -f docker-compose.single.yml down

# Stop and wipe all data
docker compose -f docker-compose.single.yml down -v
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent can't connect to ingest | Check `docker compose ps`, verify port 9443 is reachable, check `ca_cert_file` path |
| `invalid or expired enrolment token` | Create a new token in Settings → Agent Enrolment |
| Agent stays in pending state | Approve it in the Hosts page pending panel |
| Migrations failed | Ensure the `db` container is healthy before running migrations |
| `certificate signed by unknown authority` | Set `ca_cert_file` to point to `deploy/dev-tls/server.crt` |
