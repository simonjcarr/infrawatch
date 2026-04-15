---
sidebar_position: 2
---

# Air-Gap Deployment

Infrawatch is designed to work in fully air-gapped environments — no internet access is required for any core feature, including agent registration, metrics collection, alerting, and agent binary distribution.

---

## What "Air-Gapped" Means Here

- All Docker images are bundled into a single tarball for transfer
- The web app serves agent binaries from internal storage — agents never download from the internet
- Licence validation uses a bundled public key (no phone-home)
- All TLS certificates are self-signed or from your internal CA
- No external CDN dependencies — all static assets are self-hosted

---

## Bundling the Images

On a machine with internet access, run the bundle script to pull all images and save them to a tarball:

```bash
# Clone the repo (or download just the scripts)
git clone https://github.com/simonjcarr/infrawatch
cd infrawatch

# Bundle all images into a single tarball
bash deploy/scripts/airgap-bundle.sh

# Output: infrawatch-bundle-<version>.tar.gz
```

The tarball contains:
- `web` image
- `ingest` image
- `timescale/timescaledb` image
- `docker-compose.single.yml`
- `start.sh`
- `.env.example`

---

## Transferring the Bundle

```bash
# Copy to the target server (adjust as appropriate)
scp infrawatch-bundle-*.tar.gz ops@air-gapped-server:/opt/infrawatch/
```

Or use a USB drive, secure FTP, or any other approved transfer mechanism.

---

## Loading Images on the Target Server

```bash
cd /opt/infrawatch
tar -xzf infrawatch-bundle-*.tar.gz
docker load < images.tar
```

---

## Starting the Stack

```bash
# First run: creates .env
./start.sh
nano .env     # configure BETTER_AUTH_URL, passwords, etc.

# Second run: starts everything
./start.sh
```

No internet access is used during startup. The web container runs migrations from the bundled Drizzle schema — no external migration service is contacted.

---

## Agent Distribution

Agent binaries are hosted by the web app, not downloaded from GitHub. The ingest service serves a manifest of available agent versions, and the web app serves the binaries from its `AGENT_DIST_DIR` volume.

To add a new agent binary to an air-gapped deployment:

1. Build the agent on a machine with internet access:
   ```bash
   make agent-all   # builds for linux/amd64, linux/arm64, darwin/amd64
   ```

2. Transfer the binary to the server:
   ```bash
   scp dist/agent-linux-amd64 ops@server:/var/lib/infrawatch/agent-dist/
   ```

3. Update the agent version manifest in the web UI: **Settings → Agents → Update Manifest**

Agents poll the ingest service for the minimum required version. When a newer binary is available, they download it from the web app — entirely within your network.

---

## Updates

To update Infrawatch in an air-gapped environment, repeat the bundle and transfer process with the new version:

```bash
# On internet-connected machine
INFRAWATCH_VERSION=v0.4.0 bash deploy/scripts/airgap-bundle.sh

# Transfer the new tarball
scp infrawatch-bundle-v0.4.0.tar.gz ops@server:/opt/infrawatch/

# On the target server
docker load < images.tar
docker compose -f docker-compose.single.yml pull   # no-op: images already loaded
docker compose -f docker-compose.single.yml up -d  # restarts with new images
```

---

## Licence Validation

Infrawatch validates enterprise licences offline using a signed JWT verified against a public key that is bundled with the binary. No network request is made. To update a licence, paste the new licence key into **Settings → Licence**.
