# Local Dev Stack

Use `./dev-stack.sh` from the repository root when you want fast local feedback
without waiting for a release, image publication, or a test-server update.

The command starts the production-adjacent dependencies in Docker and runs the
web app in a Docker dev container with your source checkout bind-mounted for hot
reload:

- `http://localhost:3000` — local dev proxy and the only browser URL you need
- `http://localhost:3001` — direct Next.js dev server with hot reload inside Docker
- `localhost:9443` — ingest gRPC for agents
- `localhost:55432` — CT-Ops Postgres, bound to loopback only
- Password Manager API and database in Docker

## Start

Prerequisite:

- Docker Desktop or Docker Engine with the Compose plugin

```bash
./dev-stack.sh
```

The first run creates `.dev/dev.env` and `apps/web/.env.local` with local-only
secrets and URLs. The root `.env` used by the release/test-server path is not
modified.

For local Docker agent containers, the generated config sets
`AGENT_DOWNLOAD_BASE_URL=http://host.docker.internal:3000` and adds an empty
`CT_OPS_ENROLMENT_TOKEN=` placeholder. Paste a valid token into that placeholder
before running `deploy/scripts/create-agent-dev-container.sh`.

The `web-migrate` and `web-dev` containers run `pnpm install --frozen-lockfile`
inside Docker using named volumes for `node_modules`, so Linux container
dependencies do not overwrite host dependencies. The `ingest-dev` container uses
Go module and build-cache volumes for the same reason.

Open:

```text
http://localhost:3000
```

The dev proxy forwards:

- `/` to the Next.js dev server
- `/password-manager-api/` to the bundled Password Manager API container
- `/ws/terminal/` to the local ingest container

## Connect Agents

Use public mode when you need real hosts or VMs to connect agents back to your
local development stack:

```bash
./dev-stack.sh --public-host 100.x.y.z
```

Use your Tailscale IP for `100.x.y.z` when possible. It is more reliable than a
changing Wi-Fi address and avoids exposing your development laptop to the public
internet. If you omit the host, `./dev-stack.sh --public` tries to pick a
Tailscale IP first, then a local network IP.

Public mode changes only the externally required ports:

- web proxy: `0.0.0.0:3000`
- ingest HTTP health/JWKS: `0.0.0.0:8080`
- ingest gRPC for agents: `0.0.0.0:9443`
- Postgres remains private on `127.0.0.1:55432`

The script updates `.dev/dev.env`, regenerates the development ingest TLS cert
when the public host changes, and prints the agent connection details:

```text
Agent ingest address: 100.x.y.z:9443
Agent CA cert:        deploy/dev-tls/server.crt
```

Validate the reachable endpoints from your laptop:

```bash
./dev-stack.sh --check-public
```

Agents must be able to reach `100.x.y.z:9443` and trust the generated CA cert.
For browser-based agent install bundles, the app will use
`AGENT_DOWNLOAD_BASE_URL=http://100.x.y.z:3000`, so the remote host must also be
able to reach port `3000`.

For same-machine Docker agent containers, leave the stack in local mode and run:

```bash
deploy/scripts/create-agent-dev-container.sh
```

The helper reads `.dev/dev.env`, creates one long-lived systemd Ubuntu
container, and runs the normal CT-Ops agent install script inside it.

Switch back to loopback-only mode with:

```bash
./dev-stack.sh --local
```

## Stop Or Reset

Stop the stack while preserving local database volumes:

```bash
./dev-stack.sh --down
```

Remove local dev volumes and generated local config:

```bash
./dev-stack.sh --reset
```

## Checks

After the stack is running, check the proxy, Password Manager API, and ingest
health endpoints:

```bash
./dev-stack.sh --check
```

Show current local service status:

```bash
./dev-stack.sh --status
```

## Rebuilds

The script builds agent binaries if they are missing. Rebuild them explicitly
after changing agent code:

```bash
./dev-stack.sh --rebuild-agents
```

## Next.js Flags

By default the script runs Next.js with Turbopack inside Docker:

```text
CT_OPS_DEV_NEXT_FLAGS=--turbopack
```

If you need the webpack dev server instead, set this in `.dev/dev.env` before
starting:

```text
CT_OPS_DEV_NEXT_FLAGS=--webpack
```

## Environment Separation

The local dev stack deliberately uses separate config, ports, and Docker
volumes from the release bundle:

- local dev config: `.dev/dev.env` and `apps/web/.env.local`
- release/test-server config: root `.env`
- local Compose project: `ct-ops-dev`
- release Compose project: the bundle directory default

This means you can use `./dev-stack.sh` locally and still use `./update.sh` or
`./start.sh` on a test server without manually changing environment variables
between modes.
