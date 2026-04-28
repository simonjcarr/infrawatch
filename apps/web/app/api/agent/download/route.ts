import { NextRequest, NextResponse } from 'next/server'
import {
  SUPPORTED_OS,
  SUPPORTED_ARCH,
  resolveAgentBinary,
  binaryUnavailableMessage,
  type AgentOS,
  type AgentArch,
} from '@/lib/agent/binary'
import { createRateLimiter } from '@/lib/rate-limit'

// 20 requests per IP per 60 s — prevents binary-download floods while accommodating automation.
const downloadRateLimit = createRateLimiter({
  scope: 'agent:download',
  windowMs: 60_000,
  max: 20,
})

/**
 * Serves the agent binary for the required version (pinned in lib/agent/version.ts).
 *
 * Resolution order:
 *   1. Versioned local file in AGENT_DIST_DIR — served immediately if cached
 *   2. GitHub Release for the required version — downloads, caches, then serves
 *   3. Unversioned file in AGENT_DIST_DIR — operator-managed volume / local dev
 *   4. Unversioned file baked into image (data/agent-dist/) — air-gap bootstrap
 *   5. 503 if nothing available
 *
 * Query params: os (linux|darwin|windows), arch (amd64|arm64)
 */
export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  if (!await downloadRateLimit.check(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait before trying again.' },
      { status: 429 },
    )
  }

  const { searchParams } = new URL(request.url)
  const os = searchParams.get('os')
  const arch = searchParams.get('arch')

  if (!os || !SUPPORTED_OS.includes(os as AgentOS)) {
    return NextResponse.json(
      { error: `os must be one of: ${SUPPORTED_OS.join(', ')}` },
      { status: 400 },
    )
  }
  if (!arch || !SUPPORTED_ARCH.includes(arch as AgentArch)) {
    return NextResponse.json(
      { error: `arch must be one of: ${SUPPORTED_ARCH.join(', ')}` },
      { status: 400 },
    )
  }

  const binary = await resolveAgentBinary(os as AgentOS, arch as AgentArch)
  if (!binary) {
    return NextResponse.json(
      { error: binaryUnavailableMessage(os as AgentOS, arch as AgentArch) },
      { status: 503 },
    )
  }

  return new NextResponse(new Uint8Array(binary.bytes), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${binary.fileName}"`,
      'Content-Length': String(binary.bytes.byteLength),
    },
  })
}
