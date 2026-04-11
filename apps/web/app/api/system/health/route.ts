import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users, agents, hosts, organisations } from '@/lib/db/schema'
import { eq, and, isNull, count } from 'drizzle-orm'
import pkg from '../../../../package.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user?.organisationId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = user.organisationId

  const [agentRows, org] = await Promise.all([
    db
      .select({ status: agents.status, count: count() })
      .from(agents)
      .innerJoin(hosts, and(eq(hosts.agentId, agents.id), isNull(hosts.deletedAt)))
      .where(and(eq(agents.organisationId, orgId), isNull(agents.deletedAt)))
      .groupBy(agents.status),

    db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
    }),
  ])

  const agentMap = Object.fromEntries(agentRows.map((r) => [r.status, r.count]))
  const agentOnline = agentMap['active'] ?? 0
  const agentOffline = agentMap['offline'] ?? 0
  const agentTotal = Object.values(agentMap).reduce((s, n) => s + n, 0)

  return Response.json({
    version: pkg.version,
    licenceTier: org?.licenceTier ?? 'community',
    metricRetentionDays: org?.metricRetentionDays ?? 30,
    database: { connected: true },
    agents: {
      online: agentOnline,
      offline: agentOffline,
      total: agentTotal,
    },
  })
}
