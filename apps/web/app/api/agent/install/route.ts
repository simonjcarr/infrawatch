import { NextRequest, NextResponse } from 'next/server'
import { buildAgentInstallScript } from '@/lib/agent/install-script'
import { createRateLimiter } from '@/lib/rate-limit'

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
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  if (!await installRateLimit.check(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait before trying again.' },
      { status: 429 },
    )
  }

  const host = request.headers.get('host') ?? 'localhost'
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  const serverURL = `${proto}://${host}`

  const { searchParams } = new URL(request.url)
  const bareHost = host.split(':')[0]
  const ingestAddress = searchParams.get('ingest') ?? `${bareHost}:9443`
  const skipVerify = searchParams.get('skip_verify') === 'true'
  const script = buildAgentInstallScript(serverURL, ingestAddress, skipVerify)

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
