import crypto from 'crypto'
import JSZip from 'jszip'
import type { AgentOS, AgentArch } from './binary'

export interface BundleOptions {
  os: AgentOS
  arch: AgentArch
  binary: { bytes: Buffer; fileName: string }
  serverUrl: string
  ingestAddress: string
  skipVerify: boolean
  /** Embedded enrolment token — when omitted, the operator supplies it during install. */
  token?: string
  /** Human-readable expiry text for the README (e.g. "2026-04-24 13:01 UTC") — only used when a token is embedded. */
  tokenExpiresAt?: Date
  /** Version string of the binary for the README (e.g. "v0.9.0"). */
  agentVersion: string
  /** Tags to apply on every registration from this bundle. Embedded into agent.toml and passed as --tag flags into the installer. */
  tags?: Array<{ key: string; value: string }>
  /**
   * PEM-encoded server TLS CA cert. When provided the zip ships a
   * server-ca.crt file and agent.toml points at it, so skip_verify is
   * unnecessary even for self-signed dev setups.
   */
  serverCaPem?: string
}

function escapeToml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function renderTagTomlLine(tags: Array<{ key: string; value: string }> | undefined): string {
  if (!tags || tags.length === 0) {
    return `# Tags applied on every registration. Each entry is "key:value".
# tags = ["env:prod", "team:platform"]
tags = []`
  }
  const rendered = tags
    .map((t) => `"${escapeToml(t.key)}:${escapeToml(t.value)}"`)
    .join(', ')
  return `# Tags applied on every registration. Each entry is "key:value".
tags = [${rendered}]`
}

function renderUnixTagFlags(tags: Array<{ key: string; value: string }> | undefined): string {
  if (!tags || tags.length === 0) return ''
  return tags
    .map((t) => {
      const kv = `${t.key}=${t.value}`.replace(/"/g, '\\"')
      return ` --tag "${kv}"`
    })
    .join('')
}

function renderWindowsTagFlags(tags: Array<{ key: string; value: string }> | undefined): string {
  if (!tags || tags.length === 0) return ''
  return tags
    .map((t) => {
      const kv = `${t.key}=${t.value}`.replace(/"/g, '`"')
      return ` --tag "${kv}"`
    })
    .join('')
}

/**
 * Produces an offline install bundle as a zip buffer. Layout:
 *
 *   ct-ops-agent-<os>-<arch>/
 *     ct-ops-agent[.exe]
 *     agent.toml
 *     install.sh         (linux / darwin)
 *     install.ps1        (windows)
 *     SHA256SUMS
 *     README.md
 */
export async function buildInstallBundle(opts: BundleOptions): Promise<{
  zipBytes: Buffer
  fileName: string
}> {
  const zip = new JSZip()
  const rootName = `ct-ops-agent-${opts.os}-${opts.arch}`
  const root = zip.folder(rootName)
  if (!root) throw new Error('Failed to create zip root folder')

  // Binary — preserve executable bit on POSIX extractions.
  const binaryMode = opts.os === 'windows' ? 0o644 : 0o755
  root.file(opts.binary.fileName, opts.binary.bytes, {
    binary: true,
    unixPermissions: binaryMode,
  })

  // Config template (agent.toml)
  root.file('agent.toml', renderAgentToml(opts))

  // Ship the server CA cert alongside the config so agents can verify TLS
  // without --tls-skip-verify in production installs.
  if (opts.serverCaPem) {
    root.file('server-ca.crt', opts.serverCaPem, { unixPermissions: 0o644 })
  }

  // Install script(s)
  if (opts.os === 'windows') {
    root.file('install.ps1', renderWindowsInstallScript(opts), {
      unixPermissions: 0o644,
    })
  } else {
    root.file('install.sh', renderUnixInstallScript(opts), {
      unixPermissions: 0o755,
    })
  }

  // Checksums
  root.file('SHA256SUMS', renderChecksums(opts))

  // README
  root.file('README.md', renderReadme(opts))

  const zipBytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  })

  return { zipBytes, fileName: `${rootName}.zip` }
}

function renderAgentToml(opts: BundleOptions): string {
  const skipVerify = opts.skipVerify ? 'true' : 'false'
  const tokenLine = opts.token
    ? `org_token = "${opts.token}"`
    : `# Paste the enrolment token from the CT-Ops UI (Settings → Agent Enrolment).
# Can also be set via the CT_OPS_ORG_TOKEN environment variable.
org_token = ""`

  return `# CT-Ops Agent Configuration
# Generated install bundle — edit values as needed before running install.

[ingest]
# Address of the CT-Ops ingest service (host:port)
address = "${opts.ingestAddress}"

# Path to the server's CA certificate for TLS verification.
# The enrolment bundle ships this file alongside agent.toml when available.
# Leave empty to use the system's default CA bundle.
ca_cert_file = "${opts.serverCaPem ? './server-ca.crt' : ''}"

# Disable TLS certificate verification entirely. INSECURE — for development or
# self-signed setups only.
tls_skip_verify = ${skipVerify}

[agent]
${tokenLine}

# Directory where the agent stores its identity keypair and state.
# Must be writable by the user running the agent.
data_dir = "/var/lib/ct-ops/agent"

# How often to send a heartbeat to the ingest service (seconds)
heartbeat_interval_secs = 30

${renderTagTomlLine(opts.tags)}
`
}

function renderUnixInstallScript(opts: BundleOptions): string {
  const tlsFlag = opts.skipVerify ? ' --tls-skip-verify' : ''
  const tokenArg = opts.token ? `"${opts.token}"` : '"$CT_OPS_ORG_TOKEN"'
  const tokenGuard = opts.token
    ? ''
    : `if [ -z "\${CT_OPS_ORG_TOKEN:-}" ]; then
  echo "Set CT_OPS_ORG_TOKEN before running this script, or pass --token to the agent manually." >&2
  exit 1
fi
`

  return `#!/bin/sh
# CT-Ops agent offline install — ${opts.os}/${opts.arch}
# Run from the extracted bundle directory:
#   sudo ./install.sh
set -e

DIR="\$(cd "\$(dirname "\$0")" && pwd)"
BINARY="\$DIR/${opts.binary.fileName}"

if [ ! -f "\$BINARY" ]; then
  echo "Agent binary not found at \$BINARY" >&2
  exit 1
fi

${tokenGuard}echo "Verifying checksum..."
if command -v sha256sum >/dev/null 2>&1; then
  (cd "\$DIR" && sha256sum -c SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "\$DIR" && shasum -a 256 -c SHA256SUMS)
else
  echo "Warning: no sha256sum/shasum available; skipping checksum verification" >&2
fi

chmod +x "\$BINARY"

echo "Installing ct-ops-agent..."
"\$BINARY" --install --token ${tokenArg} --address "${opts.ingestAddress}"${tlsFlag}${renderUnixTagFlags(opts.tags)}
`
}

function renderWindowsInstallScript(opts: BundleOptions): string {
  const tlsFlag = opts.skipVerify ? ' --tls-skip-verify' : ''
  const tokenExpr = opts.token
    ? `"${opts.token}"`
    : '$env:CT_OPS_ORG_TOKEN'
  const tokenGuard = opts.token
    ? ''
    : `if (-not $env:CT_OPS_ORG_TOKEN) {
  Write-Error "Set the CT_OPS_ORG_TOKEN environment variable before running this script."
  exit 1
}
`

  return `# CT-Ops agent offline install — windows/${opts.arch}
# Run from an elevated PowerShell session in the extracted bundle directory:
#   .\\install.ps1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Binary = Join-Path $ScriptDir "${opts.binary.fileName}"

if (-not (Test-Path $Binary)) {
  Write-Error "Agent binary not found at $Binary"
  exit 1
}

${tokenGuard}Write-Host "Verifying checksum..."
$expected = (Get-Content (Join-Path $ScriptDir "SHA256SUMS") | Select-String "${opts.binary.fileName}").ToString().Split()[0]
$actual = (Get-FileHash -Algorithm SHA256 $Binary).Hash.ToLower()
if ($expected -ne $actual) {
  Write-Error "Checksum mismatch: expected $expected, got $actual"
  exit 1
}
Write-Host "Checksum OK."

Write-Host "Installing ct-ops-agent..."
& $Binary --install --token ${tokenExpr} --address "${opts.ingestAddress}"${tlsFlag}${renderWindowsTagFlags(opts.tags)}
`
}

function renderChecksums(opts: BundleOptions): string {
  const hash = crypto.createHash('sha256').update(opts.binary.bytes).digest('hex')
  return `${hash}  ${opts.binary.fileName}\n`
}

function renderReadme(opts: BundleOptions): string {
  const sha256 = crypto.createHash('sha256').update(opts.binary.bytes).digest('hex')
  const tokenSection = opts.token
    ? `A single-use enrolment token is embedded in this bundle (\`agent.toml\` and \`install.sh\`).
${
  opts.tokenExpiresAt
    ? `It expires at **${opts.tokenExpiresAt.toISOString()}** and can only be used once — treat this bundle as sensitive.`
    : 'Treat this bundle as sensitive; the token grants enrolment rights to your organisation.'
}`
    : `This bundle does **not** contain an enrolment token. Before running the install script:

- **Linux / macOS:** \`export CT_OPS_ORG_TOKEN=<token-from-ui>\`
- **Windows (PowerShell):** \`$env:CT_OPS_ORG_TOKEN = "<token-from-ui>"\`

Create a token in the CT-Ops UI under **Settings → Agent Enrolment**.`

  const installCmd =
    opts.os === 'windows'
      ? 'From an elevated PowerShell prompt in the extracted bundle directory:\n\n```powershell\n.\\install.ps1\n```'
      : 'From the extracted bundle directory:\n\n```sh\nsudo ./install.sh\n```'

  return `# CT-Ops Agent — Offline Install Bundle

- **Target:** ${opts.os}/${opts.arch}
- **Agent version:** ${opts.agentVersion}
- **Server:** ${opts.serverUrl}
- **Ingest address:** ${opts.ingestAddress}

## What's in this bundle

| File | Purpose |
| --- | --- |
| \`${opts.binary.fileName}\` | The CT-Ops agent binary |
| \`agent.toml\` | Config template, pre-populated with the server URL |
| \`${opts.os === 'windows' ? 'install.ps1' : 'install.sh'}\` | Install helper that registers the agent |
| \`SHA256SUMS\` | SHA-256 checksum of the binary |
| \`README.md\` | This document |

## Enrolment token

${tokenSection}

## Install

${installCmd}

The agent will register with the CT-Ops server and appear in **Settings → Agents** as _pending_ (unless the token has auto-approve enabled). An admin approves the agent in the UI; after approval, it starts heartbeating.

## Verify manually

\`\`\`
sha256  ${sha256}
file    ${opts.binary.fileName}
\`\`\`

- **Linux / macOS:** \`sha256sum -c SHA256SUMS\` (or \`shasum -a 256 -c SHA256SUMS\`)
- **Windows:** \`Get-FileHash -Algorithm SHA256 ${opts.binary.fileName}\`

## Uninstall

\`\`\`
${opts.os === 'windows' ? `& ${opts.binary.fileName} --uninstall` : `sudo ./${opts.binary.fileName} --uninstall`}
\`\`\`

## Support

See the docs at ${opts.serverUrl}/docs or https://github.com/carrtech-dev/ct-ops for more.
`
}
