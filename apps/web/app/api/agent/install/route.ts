import { NextRequest, NextResponse } from 'next/server'
import { createRateLimiter } from '@/lib/rate-limit'

// 30 requests per IP per 60 s — generous for CI/CD pipelines but throttles enumeration/DoS.
const installRateLimit = createRateLimiter(60_000, 30)

/**
 * Returns a shell bootstrap script that detects OS/arch, downloads the agent
 * binary from this server, and either runs --install automatically (when a
 * token is provided) or prints the command for the user to complete.
 *
 * Usage — one-command install (token from UI):
 *   curl -fsSL "https://ct-ops.example.com/api/agent/install?token=<TOKEN>" | sh
 *
 * Usage — download only, then install manually:
 *   curl -fsSL "https://ct-ops.example.com/api/agent/install" | sh
 *   sudo ./ct-ops-agent --install --token <TOKEN>
 *
 * Query parameters:
 *   token       - Enrolment token from the CT-Ops UI
 *   ingest      - gRPC ingest address host:port (default: <server-hostname>:9443)
 *   skip_verify - Set to "true" to disable TLS certificate verification (for self-signed certs)
 */
export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  if (!installRateLimit.check(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait before trying again.' },
      { status: 429 },
    )
  }

  const host = request.headers.get('host') ?? 'localhost'
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  const serverURL = `${proto}://${host}`

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  const bareHost = host.split(':')[0]
  const ingestAddress = searchParams.get('ingest') ?? `${bareHost}:9443`
  const skipVerify = searchParams.get('skip_verify') === 'true'

  const script = token
    ? buildAutoInstallScript(serverURL, token, ingestAddress, skipVerify)
    : buildDownloadScript(serverURL, ingestAddress, skipVerify)

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function buildAutoInstallScript(
  serverURL: string,
  token: string,
  ingestAddress: string,
  skipVerify: boolean,
): string {
  const tlsFlag = skipVerify ? ' --tls-skip-verify' : ''
  // skip_verify=true also relaxes the bootstrap curl that downloads the
  // binary — without this, operators piping the script through bash hit a
  // "self-signed certificate" error even after passing -k to the outer
  // curl, because the outer flag does not propagate to commands in the
  // downloaded script.
  const curlFlags = skipVerify ? '-fsSLk' : '-fsSL'
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

# ── Self-install ───────────────────────────────────────────────────────────────
sudo ./ct-ops-agent --install --token "${token}" --address "${ingestAddress}"${tlsFlag}
`
}

function buildDownloadScript(
  serverURL: string,
  ingestAddress: string,
  skipVerify: boolean,
): string {
  const curlFlags = skipVerify ? '-fsSLk' : '-fsSL'
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

echo ""
echo "Binary downloaded. Now run:"
echo "  sudo ./ct-ops-agent --install --token <YOUR-TOKEN> --address ${ingestAddress}"
`
}
