import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { agentQueries } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/hosts/[id]/queries/[queryId]
// Polled by the UI (TanStack Query refetchInterval) until the agent returns
// a result via the ingest heartbeat stream.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; queryId: string }> }
) {
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

  const { id: hostId, queryId } = await params

  const row = await db.query.agentQueries.findFirst({
    where: and(
      eq(agentQueries.id, queryId),
      eq(agentQueries.hostId, hostId),
      eq(agentQueries.organisationId, user.organisationId),
      isNull(agentQueries.deletedAt),
    ),
  })

  if (!row) {
    return Response.json({ error: 'Query not found' }, { status: 404 })
  }

  // Surface expired pending rows as a timeout error to the client.
  if (row.status === 'pending' && row.expiresAt < new Date()) {
    return Response.json({
      status: 'error',
      error: 'Query timed out — the agent did not respond in time.',
    })
  }

  return Response.json({
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  })
}
