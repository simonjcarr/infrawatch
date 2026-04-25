# ct-ops — Quickstart

This bundle contains everything you need to run ct-ops on a single host
using Docker. The container images are pulled from GitHub Container Registry
(`ghcr.io/carrtech-dev/ct-ops/*`) the first time you start the stack.

## Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`)
- `openssl`
- `curl`
- `zip` (only required if you intend to build an air-gap bundle)

## First run

```sh
cd ct-ops
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
   (or load `images.tar.gz` if it is present — see *Air-gap installs* below)
4. Start the stack
5. A one-shot migration container applies database migrations before web and ingest start

Open `https://localhost` (or whatever you set as `BETTER_AUTH_URL`) and
follow the in-app onboarding to create your first organisation and admin
user. Your browser will warn about the self-signed certificate on first
visit unless you replace `deploy/tls/server.{crt,key}` with a certificate
from your own CA.

If ports 80 or 443 are already in use, set `NGINX_HTTP_PORT` and
`NGINX_HTTPS_PORT` in `.env` before the second run. Include the external
HTTPS port in `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, and
`AGENT_DOWNLOAD_BASE_URL`, for example `https://ct-ops.example.com:8443`.
If CT-Ops is running inside a VM, LXC, or Incus instance behind NAT, forward
the external HTTPS port and `9443` to the instance.

## Commands

```sh
./start.sh            # start (or update) the stack
./start.sh --logs     # tail logs from all containers
./start.sh --down     # stop the stack (data is preserved)
./start.sh --version  # show bundle version, app version and licence tier
./start.sh --help     # links to documentation and support
```

## Installing the agent

After signing in, follow the in-app instructions on the **Hosts** page to
install the agent on a server you want to monitor. Agents download their
binary from your ct-ops server using `AGENT_DOWNLOAD_BASE_URL`.

## Updating

```sh
./start.sh
```

re-pulls `:latest` and recreates any containers whose image has changed.

To pin to a specific image version instead of `:latest`, set `WEB_IMAGE`
and `INGEST_IMAGE` in `.env` (see commented examples in `.env.example`).

## Air-gap installs

For hosts with no internet access, build an offline bundle on a connected
machine:

```sh
./build-offline-installer.sh
```

This pulls every image referenced by `docker-compose.yml`, saves them to
`images.tar.gz`, and writes `ct-ops-single-<version>-airgap.zip` next to
the bundle directory. Transfer that zip to the air-gapped host, unzip,
and run `./start.sh` — it detects `images.tar.gz` and loads the images
locally instead of attempting a GHCR pull.

To update an air-gapped host, repeat the process: produce a new airgap
zip on the connected machine and ship it across.

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
