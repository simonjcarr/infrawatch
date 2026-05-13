export function buildAgentInstallUrl(appUrl: string, skipVerify: boolean): string {
  const origin = appUrl.replace(/\/$/, '')
  const installUrl = new URL(`${origin}/api/agent/install`)
  if (skipVerify) {
    installUrl.searchParams.set('skip_verify', 'true')
  }
  return installUrl.toString()
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function validatePort(port: string): void {
  if (!/^[0-9]{1,5}$/.test(port)) {
    throw new Error('Invalid agent ingest address')
  }

  const portNumber = Number(port)
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    throw new Error('Invalid agent ingest address')
  }
}

function validateDnsOrIpv4Host(host: string): void {
  if (host.length === 0 || host.length > 253) {
    throw new Error('Invalid agent ingest address')
  }

  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    throw new Error('Invalid agent ingest address')
  }

  const labels = host.split('.')
  if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new Error('Invalid agent ingest address')
  }

  if (/^[0-9.]+$/.test(host) && labels.length === 4) {
    for (const label of labels) {
      if (!/^[0-9]{1,3}$/.test(label) || Number(label) > 255) {
        throw new Error('Invalid agent ingest address')
      }
    }
  }
}

function validateIpv6Host(host: string, port: string): void {
  try {
    const parsed = new URL(`https://${host}:${port}`)
    if (parsed.hostname !== host.toLowerCase() || parsed.port !== port) {
      throw new Error('Invalid agent ingest address')
    }
  } catch {
    throw new Error('Invalid agent ingest address')
  }
}

export function validateAgentIngestAddress(value: string): string {
  const ipv6Match = value.match(/^(\[[0-9A-Fa-f:.]+\]):([0-9]{1,5})$/)
  if (ipv6Match) {
    const host = ipv6Match[1]
    const port = ipv6Match[2]
    if (!host || !port) {
      throw new Error('Invalid agent ingest address')
    }
    validatePort(port)
    validateIpv6Host(host, port)
    return value
  }

  const hostPortMatch = value.match(/^([A-Za-z0-9.-]+):([0-9]{1,5})$/)
  if (!hostPortMatch) {
    throw new Error('Invalid agent ingest address')
  }

  const host = hostPortMatch[1]
  const port = hostPortMatch[2]
  if (!host || !port) {
    throw new Error('Invalid agent ingest address')
  }
  validatePort(port)
  validateDnsOrIpv4Host(host)
  return value
}

export function buildAgentInstallCommand(
  appUrl: string,
  skipVerify: boolean,
  token?: string,
): string {
  const curlFlags = skipVerify ? '-fsSLk' : '-fsSL'
  const tokenPrefix = token ? `env CT_OPS_ENROLMENT_TOKEN=${shellSingleQuote(token)} ` : ''
  return `curl ${curlFlags} "${buildAgentInstallUrl(appUrl, skipVerify)}" | ${tokenPrefix}sh`
}

export function buildAgentInstallScript(
  serverURL: string,
  ingestAddress: string,
  skipVerify: boolean,
): string {
  const safeIngestAddress = validateAgentIngestAddress(ingestAddress)
  const tlsFlag = skipVerify ? ' --tls-skip-verify' : ''
  const curlFlags = skipVerify ? '-fsSLk' : '-fsSL'
  const installPath = `/api/agent/install${skipVerify ? '?skip_verify=true' : ''}`

  return `#!/bin/sh
set -e

# ── Detect platform ────────────────────────────────────────────────────────────
OS=\$(uname -s | tr '[:upper:]' '[:lower:]')
case "\$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: \$OS" >&2; exit 1 ;;
esac

ARCH=\$(uname -m)
case "\$ARCH" in
  x86_64)        ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: \$ARCH" >&2; exit 1 ;;
esac

# ── Download binary ────────────────────────────────────────────────────────────
echo "Downloading ct-ops-agent for \${OS}/\${ARCH}..."
curl ${curlFlags} "${serverURL}/api/agent/download?os=\${OS}&arch=\${ARCH}" -o ct-ops-agent
chmod +x ct-ops-agent
echo "Binary downloaded."

# ── Install with runtime-provided token ───────────────────────────────────────
if [ -n "\${CT_OPS_ENROLMENT_TOKEN:-}" ]; then
  sudo env CT_OPS_ENROLMENT_TOKEN="\$CT_OPS_ENROLMENT_TOKEN" ./ct-ops-agent --install --address ${shellSingleQuote(safeIngestAddress)}${tlsFlag}
  exit 0
fi

echo ""
echo "Export CT_OPS_ENROLMENT_TOKEN with an enrolment token, then rerun this command:"
echo "  curl ${curlFlags} \\"${serverURL}${installPath}\\" | sh"
echo ""
echo "You can also install manually:"
echo "  sudo ./ct-ops-agent --install --token <YOUR-TOKEN> --address ${shellSingleQuote(safeIngestAddress)}${tlsFlag}"
`
}
