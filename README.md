# CT-Ops

> Infrastructure monitoring built for engineering teams that can't phone home.

CT-Ops is an open-source monitoring and operations platform designed to run **entirely on your own infrastructure** — no SaaS dependencies, no telemetry, no licence servers. Deploy it in five minutes on a single Docker host or scale it to a Redpanda-backed HA cluster. Either way, it works in an air-gapped environment out of the box.

**[Documentation →](https://carrtech-dev.github.io/ct-ops/)**

---

## Features

- **Agent-based host monitoring** — lightweight Go agent, single binary, communicates over gRPC/mTLS on port 9443. Browser traffic terminates TLS on 443 via a bundled nginx container.
- **Real-time metrics** — CPU, memory, disk, and network graphs backed by TimescaleDB, visible seconds after agent enrolment.
- **Alerting & notification routing** — rule-based alerts with configurable thresholds and multi-channel notification delivery.
- **Certificate lifecycle management** — inspect, validate, and track X.509 certificates from URL or file upload. Expiry alerts built in.
- **Network inventory** — CIDR-based network management with a live topology graph view.
- **Directory user lookup** — query LDAP/Active Directory in real time, no sync job required. Community tier (no paywall).
- **Service account & identity tracking** — inventory SSH keys, API tokens, and service identities across your estate.
- **Host groups & tagging** — flexible `key:value` tags on any resource, group-based access control for teams.
- **Terminal workspace** — split-pane browser terminal for ad-hoc investigation without leaving the dashboard.
- **Air-gap agent bundles** — download a self-contained zip (binary + config + install script) for hosts that can't reach the internet.
- **Multi-tenant RBAC** — `super_admin` → `org_admin` → `engineer` → `read_only` → `agent` role hierarchy.
- **Three deployment profiles** — `single` (one host), `standard` (Redpanda), `ha` (clustered) — same codebase, different `docker-compose` files.

---

## Quick Start

**Requirements:** Docker, `curl`, `unzip`, `openssl`. Do not run as root.

```bash
# Download and unpack the latest release
# The installer verifies the published SHA-256 checksum before unpacking.
curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh | bash

cd ct-ops

# First run creates .env from the example file
./start.sh

# Set your domain and credentials
$EDITOR .env

# Boot the stack
./start.sh
```

Open `https://localhost` (or the domain you configured) to complete setup. Your browser will warn about the self-signed certificate on first visit — accept it, or drop a real cert into `deploy/tls/server.{crt,key}` and restart the `nginx` container.

To pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/carrtech-dev/ct-ops/main/install.sh \
  | CT_OPS_VERSION=v0.3.0 bash
```

### Enrol your first agent

Once the stack is running, go to **Administration → Agents → Enrolment** in the UI. Copy the one-line install command or download an offline bundle for air-gapped hosts.

---

## Documentation

Full docs — installation, configuration, architecture, deployment profiles, and feature guides — are at:

**https://carrtech-dev.github.io/ct-ops/**

---

## Deployment Profiles

| Profile | When to use |
|---|---|
| `docker-compose.single.yml` | Single host, in-process queue, up to ~50 agents |
| `docker-compose.standard.yml` | Single Redpanda node, production workloads |
| `docker-compose.ha.yml` | Redpanda cluster, multiple ingest and web nodes, HAProxy |

All profiles produce a self-contained tarball suitable for air-gap deployment via `deploy/scripts/airgap-bundle.sh`.

---

## Licence

| Component | Licence |
|---|---|
| Core platform & web app | Apache 2.0 |
| Agent | Apache 2.0 |
| Enterprise features (`apps/web/enterprise/`) | Proprietary (source-available) |

The agent is always open source — security teams need to audit what runs on their hosts.

---

## Contributing

Issues and PRs are welcome. See [CLAUDE.md](CLAUDE.md) for architecture decisions and conventions.
