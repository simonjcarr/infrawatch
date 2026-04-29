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

export function buildAgentInstallCommand(
  appUrl: string,
  skipVerify: boolean,
  token?: string,
): string {
  const curlFlags = skipVerify ? '-fsSLk' : '-fsSL'
  const tokenPrefix = token ? `env CT_OPS_ORG_TOKEN=${shellSingleQuote(token)} ` : ''
  return `curl ${curlFlags} "${buildAgentInstallUrl(appUrl, skipVerify)}" | ${tokenPrefix}sh`
}

export function buildAgentInstallScript(
  serverURL: string,
  ingestAddress: string,
  skipVerify: boolean,
): string {
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
if [ -n "\${CT_OPS_ORG_TOKEN:-}" ]; then
  sudo env CT_OPS_ORG_TOKEN="\$CT_OPS_ORG_TOKEN" ./ct-ops-agent --install --address "${ingestAddress}"${tlsFlag}
  exit 0
fi

echo ""
echo "Export CT_OPS_ORG_TOKEN with an enrolment token, then rerun this command:"
echo "  curl ${curlFlags} \\"${serverURL}${installPath}\\" | sh"
echo ""
echo "You can also install manually:"
echo "  sudo ./ct-ops-agent --install --token <YOUR-TOKEN> --address ${ingestAddress}${tlsFlag}"
`
}
