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
- `REQUIRE_EMAIL_VERIFICATION` — defaults to `true`; set `false` only if
  local email/password users should be allowed in without verifying email
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
3. Pull the release-pinned `web`, `ingest`, and `db` images from GHCR
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
./upgrade.sh          # back up this install and upgrade to the latest release
./backup.sh           # create a manual backup archive
./refresh_licence_key # download the latest licence verifier public key
./generate_support_data  # create a redacted support archive
```

## Installing the agent

After signing in, follow the in-app instructions on the **Hosts** page to
install the agent on a server you want to monitor. Agents download their
binary from your ct-ops server using `AGENT_DOWNLOAD_BASE_URL`.

## Updating

```sh
./upgrade.sh
```

backs up the current install, downloads the latest release bundle, stops the
stack without deleting named volumes, installs the new release files in place,
preserves `.env` and TLS material, and starts the upgraded stack. Database
migrations run before web and ingest start.

To upgrade to a specific version:

```sh
./upgrade.sh --version v0.3.0
```

For air-gapped hosts, copy the new air-gap zip to the server and run:

```sh
./upgrade.sh --from-zip /path/to/ct-ops-single-v0.3.0-airgap.zip
```

Do not edit only one image reference. `web` and `ingest` are released as a
matched pair in each bundle.

## Backups

```sh
./backup.sh
```

creates a backup archive next to the install directory by default. It includes
the local bundle files, `.env`, TLS material, `licence-keys/current.pem`, and a
database dump when the `db` container is running. The archive contains secrets;
store it securely. `upgrade.sh` calls this script automatically before replacing
release files.

## Licence verifier key

`licence-keys/current.pem` is the current CarrTech public key used to validate
newly pasted licence JWTs. The same key is also baked into the web image during
release. When a licence is saved, CT-Ops stores the exact public key that
validated it in the database and keeps using that stored key for that licence,
so later image upgrades or key rotations do not invalidate active licences.

Connected installs can fetch the latest verifier key from GitHub without a full
upgrade:

```sh
./refresh_licence_key
```

For release engineering, the current public key is published in
`carrtech-dev/licence-public-keys` at `ct-ops/current.pem`. CT-Ops release
packaging fetches that file into the web image and customer bundle as
`licence-keys/current.pem`. CT Portal keeps the private key; never place the
private key in CT Ops or in a customer bundle.

For air-gapped installs, upgrade CT-Ops to a release built after the CarrTech
key rotation before activating licences purchased after that rotation.

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

When opening a support request, run:

```sh
./generate_support_data
```

This creates `ct-ops-support-data-<timestamp>.tar.gz` next to
`docker-compose.yml`. It includes sanitized settings, Docker status, recent
logs, host information, file metadata, and TLS certificate fingerprints. It
does not include raw `.env` files, private keys, or database dumps. Review the
archive before attaching it to a ticket.

Data lives in named Docker volumes (`db_data`, `ingest_data`, `agent_dist`).

## Uninstall

```sh
docker compose down -v
```

This removes the containers **and the volumes** — destroying all stored
data. Back up first if you need to keep anything.
