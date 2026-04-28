# Offline Agent Install Bundle

For air-gapped or change-controlled environments you can download a **zip bundle** from the CT-Ops UI, transfer it to a target host, and install the agent without any network access to the CT-Ops server at install time.

## What's in the bundle

Each zip contains everything needed to install the agent on one OS / architecture:

| File | Purpose |
| --- | --- |
| `ct-ops-agent[.exe]` | The agent binary for the selected OS / arch |
| `agent.toml` | Config template, pre-populated with the server URL |
| `install.sh` or `install.ps1` | Install helper that registers the agent |
| `SHA256SUMS` | SHA-256 checksum for the binary |
| `README.md` | Step-by-step install instructions |

## Who can generate a bundle

Bundle generation is gated to **`super_admin`** and **`org_admin`** roles. Every bundle is scoped to the organisation of the requesting user.

## Generate and download

1. Sign in to the CT-Ops web UI.
2. Go to **Administration → Agents → Enrolment**.
3. Click **Download Install Bundle**.
4. Pick the target **OS** (Linux, macOS, Windows) and **architecture** (amd64, arm64).
5. Choose how the enrolment token is handled:
   - **Create a new single-use token** (recommended). A fresh token is generated, limited to one use, and expires in the number of days you choose (default 7). The token is embedded in `agent.toml` and the install script.
   - **Embed an existing token**. Pick one of your active tokens — useful when you have a long-lived token shared across a rollout batch.
   - **No token**. The bundle ships without a token. The operator exports `CT_OPS_ORG_TOKEN` on the target host before running the install script.
6. Optionally override the **ingest address** (defaults to `<this-server>:9443`).
7. Optionally add **tags** as `key:value` pairs. These are baked into
   `agent.toml` and passed as `--tag` flags by the install script, so every
   host installed from the bundle registers with those tags. See
   [Tags](../features/tags.md) for how tags are merged with org defaults and
   CLI flags.
8. Click **Download**. The browser downloads `ct-ops-agent-<os>-<arch>.zip`.

> **Heads up — token sensitivity.** When a token is embedded, treat the zip as sensitive: anyone with the file can register an agent against your organisation until the token is used, expired, or revoked. Single-use + short-expiry defaults limit the blast radius if the file leaks.

## Install on Linux / macOS

Transfer the zip to the target host, then:

```sh
unzip ct-ops-agent-linux-amd64.zip
cd ct-ops-agent-linux-amd64
sudo ./install.sh
```

If the bundle does **not** contain a token:

```sh
export CT_OPS_ORG_TOKEN="<token-from-ui>"
sudo -E ./install.sh
```

The install script verifies the binary against `SHA256SUMS`, then runs the agent's `--install` step, which writes the systemd unit (or launchd plist on macOS) and starts the service.

## Install on Windows

From an elevated PowerShell session in the extracted bundle directory:

```powershell
.\install.ps1
```

If the bundle does **not** contain a token:

```powershell
$env:CT_OPS_ORG_TOKEN = "<token-from-ui>"
.\install.ps1
```

The PowerShell script verifies the binary via `Get-FileHash`, then runs the `--install` step which registers the agent as a Windows service.

## Verify the download manually

The `README.md` inside every bundle lists the expected SHA-256 of the binary. You can verify it independently:

```sh
# Linux / macOS
sha256sum -c SHA256SUMS

# Windows (PowerShell)
Get-FileHash -Algorithm SHA256 ct-ops-agent-windows-amd64.exe
```

## After install

The agent registers against the CT-Ops server and appears in **Settings → Agents** as `pending` — unless the embedded token has auto-approve enabled. An admin approves the agent from the UI; heartbeats start flowing immediately after approval.

## Audit trail

When you choose **Create a new single-use token**, the token row is persisted in the `agent_enrolment_tokens` table with:

- `createdById` — the user who generated the bundle
- `createdAt` — the timestamp
- `metadata.source` = `install-bundle`
- `metadata.os` / `metadata.arch` — the target platform

The same token is consumed on first use, and usage is tracked via `usageCount`. Revoke a token at any time from **Administration → Agents → Enrolment → Revoke**.

## Troubleshooting

- **HTTP 503 when downloading the bundle:** the server could not resolve the agent binary for the selected OS / arch. Ensure a binary is present in `AGENT_DIST_DIR`, or that a GitHub release exists for the tag `agent/<REQUIRED_AGENT_VERSION>`.
- **Agent stays `pending` in the UI:** the token does not have auto-approve enabled. Approve the agent manually in **Settings → Agents**.
- **Install script fails with `Checksum mismatch`:** the bundle was corrupted in transfer — re-download and retry.
- **Agent cannot reach the ingest service:** verify the `ingest.address` in `agent.toml` and that port 9443 (or the configured port) is reachable from the host.
