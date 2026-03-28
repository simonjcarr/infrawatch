# Getting Started

This guide walks you through getting Infrawatch running locally — from a fresh clone to a real agent showing up as online in the host inventory.

**What you'll have at the end:** a running stack (PostgreSQL + ingest service + web UI), a registered and approved agent, and the host appearing in `/hosts` with live heartbeat data.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker + Docker Compose | v2.x | Runs the full stack |
| Go | 1.23+ | Building the agent binary |
| Node.js | 20+ | Running the web app locally (optional if using Docker) |
| pnpm | 10+ | Package manager for the web app |
| openssl | any | Generating dev TLS certificates |

---

## Step 1 — Clone and install dependencies

```bash
git clone <repo-url> infrawatch
cd infrawatch
pnpm install
```

---

## Step 2 — Generate dev TLS certificates

The ingest service (gRPC) requires TLS. For local development, generate a self-signed certificate:

```bash
make dev-tls
```

This creates `deploy/dev-tls/server.crt` and `deploy/dev-tls/server.key`. These files are gitignored — regenerate them after a clean checkout.

---

## Step 3 — Configure environment variables

Copy the example env file:

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

---

## Step 4 — Start the stack

```bash
docker compose -f docker-compose.single.yml up -d
```

This starts:
- **`db`** — PostgreSQL + TimescaleDB on port 5432
- **`web`** — Next.js web UI on port 3000
- **`ingest`** — gRPC ingest service on port 9443, JWKS/health on port 8080

Wait for all services to be healthy:

```bash
docker compose -f docker-compose.single.yml ps
```

All three should show `healthy` or `running`.

---

## Step 5 — Run database migrations

The schema needs to be applied to the database. From the `apps/web` directory:

```bash
cd apps/web
pnpm db:migrate
cd ../..
```

> **Note:** You need `apps/web/.env.local` present with a valid `DATABASE_URL` for this to work. If using Docker, make sure the `db` container is running first.

---

## Step 6 — Create your account

Open [http://localhost:3000](http://localhost:3000) in a browser.

1. Click **Register** and create your account
2. You'll be taken through the **onboarding wizard** — enter your organisation name and click **Create Organisation**
3. You're now logged in as `super_admin`

---

## Step 7 — Create an enrolment token

An enrolment token is what the agent uses to register itself with your organisation.

1. In the sidebar, click **Agent Enrolment** (under Administration)
2. Click **New Token**
3. Give it a label (e.g. `dev-servers`)
4. Tick **Auto-approve agents** for development — this skips the manual approval step
5. Click **Create Token**
6. **Copy the token now** — it won't be shown in full again

---

## Step 8 — Build the agent

```bash
make agent
```

This produces `dist/agent`. Alternatively, build and run directly:

```bash
go build -o dist/agent ./agent/cmd/agent
```

---

## Step 9 — Configure the agent

Create a config file for the agent. Copy the example:

```bash
cp agent/examples/agent.toml /tmp/agent.toml
```

Edit `/tmp/agent.toml`:

```toml
[ingest]
address = "localhost:9443"
ca_cert_file = "deploy/dev-tls/server.crt"   # path to the dev cert generated in Step 2

[agent]
org_token = "YOUR_TOKEN_FROM_STEP_7"          # paste the token here
data_dir = "/tmp/infrawatch-agent"
version = "0.1.0"
heartbeat_interval_secs = 30
```

The `ca_cert_file` tells the agent to trust the self-signed dev certificate. Without it, TLS verification will fail against a self-signed cert.

---

## Step 10 — Run the agent

```bash
./dist/agent -config /tmp/agent.toml
```

You should see output like:

```
time=... level=INFO msg="agent identity ready" data_dir=/tmp/infrawatch-agent
time=... level=INFO msg="registering agent" address=localhost:9443
time=... level=INFO msg="registration response" status=active agent_id=abc123... message="agent registered and auto-approved"
time=... level=INFO msg="agent registered and active" agent_id=abc123...
time=... level=INFO msg="starting heartbeat" interval_secs=30
time=... level=INFO msg="heartbeat stream opened" agent_id=abc123...
```

If you **did not** enable auto-approve on the token, the status will be `pending` and the agent will poll every 30 seconds. See [Step 11a](#step-11a--approve-the-agent-manually) below.

---

## Step 11 — Verify in the UI

Open [http://localhost:3000/hosts](http://localhost:3000/hosts).

Your host should appear in the **Host Inventory** table with:
- Status badge: **Online** (green)
- Last seen: a few seconds ago
- Memory % populated (CPU requires two samples — will be added in a later session)

---

## Step 11a — Approve the agent manually

If you did **not** use auto-approve, the agent will show up in the **Pending Agent Approval** panel on the Hosts page (amber section at the top). Click **Approve** next to your agent.

The agent will pick this up on its next poll cycle (within 30 seconds), receive a JWT, and begin heartbeating. The host will then appear in the inventory as **Online**.

---

## Stopping everything

Stop the agent with `Ctrl+C` — it will gracefully close the heartbeat stream and the host status will change to **Offline**.

Stop the Docker stack:

```bash
docker compose -f docker-compose.single.yml down
```

To also remove the database volume (fresh start):

```bash
docker compose -f docker-compose.single.yml down -v
```

---

## Troubleshooting

**Agent can't connect to ingest service**
- Check the ingest container is running: `docker compose -f docker-compose.single.yml ps`
- Check the address in your agent config matches where ingest is listening (`localhost:9443`)
- Make sure `ca_cert_file` points to the correct dev cert

**`invalid or expired enrolment token`**
- The token may have been revoked or expired. Create a new one in the UI.

**`agent is not active` on heartbeat**
- The agent has not been approved yet. Check the pending panel on the Hosts page.

**Migrations failed**
- Ensure the `db` Docker container is running and `DATABASE_URL` in `.env.local` is correct
- Try `pnpm db:push` in `apps/web` for a quick schema push without migration tracking (dev only)

**`certificate signed by unknown authority`**
- Set `ca_cert_file` in the agent config to point to `deploy/dev-tls/server.crt`
