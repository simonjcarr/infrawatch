# Getting Started.

This guide walks you through getting Infrawatch running — from zero to a real agent showing up as online in the host inventory.

There are two ways to run Infrawatch:

- **[Option A — Pre-built images from GHCR](#option-a--pre-built-images-from-ghcr)** — Fastest. No clone required, just a `docker-compose.yml` and an env file.
- **[Option B — Build from source](#option-b--build-from-source)** — For development or if you want to modify the code.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker + Docker Compose | v2.x | Runs the full stack and all build steps |

That's it. No local Go, Node.js, or pnpm required.

---

## Option A — Pre-built images from GHCR

The fastest way to get Infrawatch running. One command downloads a small bundle (compose file, `start.sh`, `.env.example`, README) from the latest GitHub release and unpacks it into `./infrawatch`:

```bash
curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash
cd infrawatch
./start.sh        # first run: creates .env from the example, then exits
$EDITOR .env      # set BETTER_AUTH_URL, AGENT_DOWNLOAD_BASE_URL, etc.
./start.sh        # second run: generates secret, certs, pulls images, boots
```

To pin a specific bundle version: `INFRAWATCH_VERSION=v0.3.0 bash` instead of plain `bash`.

The bundled `start.sh` generates dev TLS certs, generates `BETTER_AUTH_SECRET` if blank, pulls the latest `web`/`ingest`/`db` images from GHCR, and starts the stack. Database migrations run inside the web container automatically on startup.

When all three containers show `healthy` in `docker compose ps`, continue from [Create your account](#step-create-your-account). The full quickstart, troubleshooting, and uninstall instructions are in `infrawatch/README.md` inside the bundle.

---

## Option B — Build from source

### Step 1 — Clone the repository

```bash
git clone https://github.com/carrtech-dev/ct-ops infrawatch
cd infrawatch
```

### Step 2 — Generate dev TLS certificates

```bash
make dev-tls
```

This creates `deploy/dev-tls/server.crt` and `deploy/dev-tls/server.key`. These files are gitignored — regenerate them after a clean checkout.

### Step 3 — Configure environment variables

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

### Step 4 — Start the stack

```bash
docker compose -f docker-compose.single.yml up -d
```

This builds the web and ingest images locally and starts:
- **`db`** — PostgreSQL + TimescaleDB on port 5432
- **`web`** — Next.js web UI on port 3000
- **`ingest`** — gRPC ingest service on port 9443, JWKS/health on port 8080

### Step 5 — Run database migrations

```bash
docker compose -f docker-compose.single.yml exec web sh -c "cd /app && node_modules/.bin/drizzle-kit migrate"
```

### Step 6 — Continue from [Create your account](#step-create-your-account)

---

## Step: Create your account

Open [http://localhost:3000](http://localhost:3000) in a browser.

1. Click **Register** and create your account
2. You'll be taken through the **onboarding wizard** — enter your organisation name and click **Create Organisation**
3. You're now logged in as `super_admin`

---

## Step: Create an enrolment token

An enrolment token is what the agent uses to register itself with your organisation.

1. In the sidebar, click **Agent Enrolment** (under Administration)
2. Click **New Token**
3. Give it a label (e.g. `dev-servers`)
4. Tick **Auto-approve agents** for development — this skips the manual approval step
5. Click **Create Token**
6. **Copy the token now** — it won't be shown in full again

---

## Step: Build the agent

```bash
make agent
```

This uses Docker to compile the Go agent and produces `dist/agent`.

---

## Step: Configure the agent

Copy the example config:

```bash
cp agent/examples/agent.toml /tmp/agent.toml
```

Edit `/tmp/agent.toml`:

```toml
[ingest]
address = "localhost:9443"
ca_cert_file = "deploy/dev-tls/server.crt"   # path to the dev cert

[agent]
org_token = "YOUR_ENROLMENT_TOKEN"            # paste the token here
data_dir = "/tmp/infrawatch-agent"
version = "0.1.0"
heartbeat_interval_secs = 30
```

The `ca_cert_file` tells the agent to trust the self-signed dev certificate. Without it, TLS verification will fail.

---

## Step: Run the agent

```bash
./dist/agent -config /tmp/agent.toml
```

You should see:

```
time=... level=INFO msg="agent identity ready" data_dir=/tmp/infrawatch-agent
time=... level=INFO msg="registering agent" address=localhost:9443
time=... level=INFO msg="registration response" status=active agent_id=abc123...
time=... level=INFO msg="agent registered and active" agent_id=abc123...
time=... level=INFO msg="starting heartbeat" interval_secs=30
time=... level=INFO msg="heartbeat stream opened" agent_id=abc123...
```

If you did **not** enable auto-approve, the agent will show `pending` and poll every 30 seconds — see [Approve the agent manually](#approve-the-agent-manually) below.

---

## Step: Verify in the UI

Open [http://localhost:3000/hosts](http://localhost:3000/hosts).

Your host should appear in the **Host Inventory** table with:
- Status badge: **Online** (green)
- Last seen: a few seconds ago

---

## Approve the agent manually

If you did **not** use auto-approve, the agent appears in the **Pending Agent Approval** panel on the Hosts page (amber section at the top). Click **Approve**.

The agent picks this up within 30 seconds, receives a JWT, and begins heartbeating. The host will then show as **Online**.

---

## Stopping everything

Stop the agent with `Ctrl+C` — it gracefully closes the heartbeat stream and the host status changes to **Offline**.

Stop the Docker stack:

```bash
# Option A (GHCR images)
docker compose down

# Option B (built from source)
docker compose -f docker-compose.single.yml down
```

To also remove database volumes (fresh start), add `-v`.

---

## Troubleshooting

**Agent can't connect to ingest service**
- Check ingest is running: `docker compose ps`
- Verify the address in your agent config matches where ingest is listening (`localhost:9443`)
- Ensure `ca_cert_file` points to the correct dev cert

**`invalid or expired enrolment token`**
- The token may have been revoked or expired. Create a new one in the UI.

**`agent is not active` on heartbeat**
- The agent has not been approved yet. Check the pending panel on the Hosts page.

**Migrations failed**
- Ensure the `db` container is running before running migrations
- Check that `DATABASE_URL` is correct

**`certificate signed by unknown authority`**
- Set `ca_cert_file` in the agent config to point to `deploy/dev-tls/server.crt`
