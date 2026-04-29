import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hosts, agentQueries } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { assertTrustedMutationOrigin } from '@/lib/security/trusted-origins'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  queryType: z.enum(['list_ports', 'list_services']),
})

// POST /api/hosts/[id]/queries
// Creates a pending ad-hoc query for the host's agent. The ingest service will
// push it onto the open gRPC heartbeat stream within ~2 seconds.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertTrustedMutationOrigin(request.headers)
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let session
  try {
    session = await getApiOrgSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
  const user = session.user

  const { id: hostId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid queryType' }, { status: 400 })
  }

  const host = await db.query.hosts.findFirst({
    where: and(
      eq(hosts.id, hostId),
      eq(hosts.organisationId, user.organisationId),
      isNull(hosts.deletedAt),
    ),
  })
  if (!host) {
    return Response.json({ error: 'Host not found' }, { status: 404 })
  }

  const expiresAt = new Date(Date.now() + 2 * 60 * 1000) // 2 minute TTL

  const inserted = await db
    .insert(agentQueries)
    .values({
      organisationId: user.organisationId,
      hostId,
      queryType: parsed.data.queryType,
      status: 'pending',
      expiresAt,
    })
    .returning({ id: agentQueries.id })

  const row = inserted[0]
  if (!row) {
    return Response.json({ error: 'Failed to create query' }, { status: 500 })
  }

  return Response.json({ id: row.id })
}
