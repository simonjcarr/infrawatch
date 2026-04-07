# Infrawatch — Quickstart

This bundle contains everything you need to run Infrawatch on a single host
using Docker. The container images are pulled from GitHub Container Registry
(`ghcr.io/simonjcarr/infrawatch/*`) the first time you start the stack.

## Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`)
- `openssl`
- `curl`

## First run

```sh
cd infrawatch
./start.sh
```

The first invocation copies `.env.example` → `.env`, sets safe permissions
on it, and exits. Open `.env` in your editor and set:

- `BETTER_AUTH_URL` — public URL of the web UI (no trailing slash)
- `BETTER_AUTH_TRUSTED_ORIGINS` — comma-separated allowed callback origins
- `AGENT_DOWNLOAD_BASE_URL` — public URL agents will hit to self-update;
  must be reachable from every agent host, not just `localhost`

Leave `BETTER_AUTH_SECRET` blank — `start.sh` will generate one for you on
the next run and write it back to `.env`.

## Second run

```sh
./start.sh
```

This will:

1. Generate `BETTER_AUTH_SECRET` if it is still blank
2. Generate dev TLS certificates under `./deploy/dev-tls/` for the ingest
   service
3. Pull the latest `web`, `ingest`, and `db` images from GHCR
4. Start the stack
5. The web container runs database migrations on its own startup

Open `http://localhost:3000` (or whatever you set as `BETTER_AUTH_URL`) and
follow the in-app onboarding to create your first organisation and admin
user.

## Installing the agent

After signing in, follow the in-app instructions on the **Hosts** page to
install the agent on a server you want to monitor. Agents download their
binary from your Infrawatch server using `AGENT_DOWNLOAD_BASE_URL`.

## Updating

```sh
./start.sh
```

re-pulls `:latest` and recreates any containers whose image has changed.

To pin to a specific image version instead of `:latest`, set `WEB_IMAGE`
and `INGEST_IMAGE` in `.env` (see commented examples in `.env.example`).

## Troubleshooting

```sh
docker compose ps                       # container status
docker compose logs web ingest db       # last logs
cat VERSION                             # bundle version
```

Data lives in named Docker volumes (`db_data`, `ingest_data`, `agent_dist`).

## Uninstall

```sh
docker compose down -v
```

This removes the containers **and the volumes** — destroying all stored
data. Back up first if you need to keep anything.
