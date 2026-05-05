import { NextRequest, NextResponse } from 'next/server'
import { buildAgentInstallScript, validateAgentIngestAddress } from '@/lib/agent/install-script'
import { getAgentPublicOrigin } from '@/lib/agent/public-origin'
import { createRateLimiter } from '@/lib/rate-limit'
import { getClientIpFromHeaders } from '@/lib/client-ip'

// 30 requests per IP per 60 s — generous for CI/CD pipelines but throttles enumeration/DoS.
const installRateLimit = createRateLimiter({
  scope: 'agent:install',
  windowMs: 60_000,
  max: 30,
})

/**
 * Returns a shell bootstrap script that detects OS/arch, downloads the agent
 * binary from this server, and installs it when CT_OPS_ORG_TOKEN is supplied
 * in the runtime environment.
 *
 * Usage — download and install after exporting a token:
 *   export CT_OPS_ORG_TOKEN="<TOKEN>"
 *   curl -fsSL "https://ct-ops.example.com/api/agent/install" | sh
 *
 * Usage — download only, then install manually:
 *   curl -fsSL "https://ct-ops.example.com/api/agent/install" | sh
 *   sudo ./ct-ops-agent --install --token <TOKEN>
 *
 * Query parameters:
 *   ingest      - gRPC ingest address host:port (default: <server-hostname>:9443)
 *   skip_verify - Set to "true" to disable TLS certificate verification (for self-signed certs)
 */
export async function GET(request: NextRequest) {
  const ip = getClientIpFromHeaders(request.headers)
  if (!await installRateLimit.check(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait before trying again.' },
      { status: 429 },
    )
  }

  const serverURL = getAgentPublicOrigin()

  const { searchParams } = new URL(request.url)
  const bareHost = new URL(serverURL).hostname
  let ingestAddress: string
  try {
    ingestAddress = validateAgentIngestAddress(searchParams.get('ingest') ?? `${bareHost}:9443`)
  } catch {
    return NextResponse.json(
      { error: 'Invalid agent ingest address. Use host:port with a port from 1 to 65535.' },
      { status: 400 },
    )
  }
  const skipVerify = searchParams.get('skip_verify') === 'true'
  const script = buildAgentInstallScript(serverURL, ingestAddress, skipVerify)

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
