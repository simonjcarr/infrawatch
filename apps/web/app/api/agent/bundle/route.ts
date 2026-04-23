import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema/auth'
import { agentEnrolmentTokens } from '@/lib/db/schema/agents'
import {
  SUPPORTED_OS,
  SUPPORTED_ARCH,
  resolveAgentBinary,
  binaryUnavailableMessage,
  type AgentOS,
  type AgentArch,
} from '@/lib/agent/binary'
import { buildInstallBundle } from '@/lib/agent/bundle'
import { REQUIRED_AGENT_VERSION } from '@/lib/agent/version'
import { readFile } from 'node:fs/promises'

const SERVER_TLS_CERT_PATH = process.env['INGEST_TLS_CERT'] ?? '/etc/ct-ops/tls/server.crt'

async function readServerCaPem(): Promise<string | undefined> {
  try {
    return await readFile(SERVER_TLS_CERT_PATH, 'utf-8')
  } catch {
    return undefined
  }
}

const requestSchema = z.object({
  os: z.enum(SUPPORTED_OS),
  arch: z.enum(SUPPORTED_ARCH),
  ingestAddress: z.string().min(1).optional(),
  /** If provided, embed an existing active token into the bundle. */
  tokenId: z.string().min(1).optional(),
  /** If provided, create a new single-use, short-lived token and embed it. */
  createToken: z
    .object({
      label: z.string().min(1).max(100),
      autoApprove: z.boolean().default(false),
      skipVerify: z.boolean().default(false),
      expiresInDays: z.number().int().positive().max(365).default(7),
      tags: z
        .array(z.object({ key: z.string().min(1).max(100), value: z.string().min(1).max(500) }))
        .default([]),
    })
    .optional(),
  /** Override the skip_verify flag written into the config (defaults to the token's value or false). */
  skipVerify: z.boolean().optional(),
  /** Tags baked directly into agent.toml / install script (applied on every registration). */
  tags: z
    .array(z.object({ key: z.string().min(1).max(100), value: z.string().min(1).max(500) }))
    .default([]),
})

/**
 * POST /api/agent/bundle
 *
 * Generates a zip containing the agent binary for a chosen OS/arch, a config
 * template, install script, SHA256 checksum, and README. Optionally creates
 * and embeds a single-use, short-lived enrolment token — this is recorded
 * in the `agent_enrolment_tokens` table (the audit trail).
 *
 * Gated on org_admin / super_admin. Scoped by organisationId.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user || !user.organisationId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (user.role !== 'super_admin' && user.role !== 'org_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    )
  }

  const { os, arch, createToken, tokenId } = parsed.data
  if (createToken && tokenId) {
    return NextResponse.json(
      { error: 'Provide either tokenId or createToken, not both' },
      { status: 400 },
    )
  }

  const orgId = user.organisationId

  // Resolve the enrolment token to embed (if any).
  let embeddedToken: string | undefined
  let embeddedTokenExpiresAt: Date | undefined
  let effectiveSkipVerify = parsed.data.skipVerify ?? false
  let bundleTags: Array<{ key: string; value: string }> = [...parsed.data.tags]

  if (tokenId) {
    const existing = await db.query.agentEnrolmentTokens.findFirst({
      where: and(
        eq(agentEnrolmentTokens.id, tokenId),
        eq(agentEnrolmentTokens.organisationId, orgId),
        isNull(agentEnrolmentTokens.deletedAt),
      ),
    })
    if (!existing) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }
    if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 400 })
    }
    if (existing.maxUses !== null && existing.usageCount >= existing.maxUses) {
      return NextResponse.json({ error: 'Token has been exhausted' }, { status: 400 })
    }
    embeddedToken = existing.token
    embeddedTokenExpiresAt = existing.expiresAt ?? undefined
    if (parsed.data.skipVerify === undefined) {
      effectiveSkipVerify = existing.skipVerify
    }
    const tokenMetaTags = existing.metadata?.tags ?? []
    if (bundleTags.length === 0 && tokenMetaTags.length > 0) {
      bundleTags = [...tokenMetaTags]
    }
  } else if (createToken) {
    // autoApprove bypasses the approval queue — restrict to super_admin (M-29).
    if (createToken.autoApprove && user.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only super_admin users may create auto-approve enrolment tokens.' },
        { status: 403 },
      )
    }
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + createToken.expiresInDays)
    const [record] = await db
      .insert(agentEnrolmentTokens)
      .values({
        organisationId: orgId,
        label: createToken.label,
        createdById: user.id,
        autoApprove: createToken.autoApprove,
        skipVerify: createToken.skipVerify,
        maxUses: 1,
        expiresAt,
        metadata: {
          source: 'install-bundle',
          os,
          arch,
          ...(createToken.tags.length > 0 ? { tags: createToken.tags } : {}),
        },
      })
      .returning()

    if (!record) {
      return NextResponse.json({ error: 'Failed to create enrolment token' }, { status: 500 })
    }
    embeddedToken = record.token
    embeddedTokenExpiresAt = record.expiresAt ?? undefined
    if (parsed.data.skipVerify === undefined) {
      effectiveSkipVerify = createToken.skipVerify
    }
    if (bundleTags.length === 0 && createToken.tags.length > 0) {
      bundleTags = [...createToken.tags]
    }
  }

  const binary = await resolveAgentBinary(os as AgentOS, arch as AgentArch)
  if (!binary) {
    return NextResponse.json(
      { error: binaryUnavailableMessage(os as AgentOS, arch as AgentArch) },
      { status: 503 },
    )
  }

  const host = request.headers.get('host') ?? 'localhost'
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  const serverUrl = `${proto}://${host}`
  const ingestAddress =
    parsed.data.ingestAddress?.trim() || `${host.split(':')[0]}:9443`

  const serverCaPem = await readServerCaPem()

  const bundle = await buildInstallBundle({
    os: os as AgentOS,
    arch: arch as AgentArch,
    binary,
    serverUrl,
    ingestAddress,
    skipVerify: effectiveSkipVerify,
    token: embeddedToken,
    tokenExpiresAt: embeddedTokenExpiresAt,
    agentVersion: REQUIRED_AGENT_VERSION,
    tags: bundleTags,
    serverCaPem,
  })

  return new NextResponse(new Uint8Array(bundle.zipBytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${bundle.fileName}"`,
      'Content-Length': String(bundle.zipBytes.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST to generate an install bundle' }, { status: 405 })
}
