import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users, agents, certificates, alertInstances } from '@/lib/db/schema'
import { eq, and, isNull, count } from 'drizzle-orm'

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

  const [agentRows, certRows, alertRows] = await Promise.all([
    db
      .select({ status: agents.status, count: count() })
      .from(agents)
      .where(and(eq(agents.organisationId, orgId), isNull(agents.deletedAt)))
      .groupBy(agents.status),

    db
      .select({ status: certificates.status, count: count() })
      .from(certificates)
      .where(and(eq(certificates.organisationId, orgId), isNull(certificates.deletedAt)))
      .groupBy(certificates.status),

    db
      .select({ status: alertInstances.status, count: count() })
      .from(alertInstances)
      .where(eq(alertInstances.organisationId, orgId))
      .groupBy(alertInstances.status),
  ])

  const agentMap = Object.fromEntries(agentRows.map((r) => [r.status, r.count]))
  const certMap = Object.fromEntries(certRows.map((r) => [r.status, r.count]))
  const alertMap = Object.fromEntries(alertRows.map((r) => [r.status, r.count]))

  return Response.json({
    agents: {
      online: agentMap['active'] ?? 0,
      offline: agentMap['offline'] ?? 0,
      total: Object.values(agentMap).reduce((s, n) => s + n, 0),
    },
    certificates: {
      valid: certMap['valid'] ?? 0,
      expiringSoon: certMap['expiring_soon'] ?? 0,
      expired: certMap['expired'] ?? 0,
    },
    alerts: {
      firing: alertMap['firing'] ?? 0,
      acknowledged: alertMap['acknowledged'] ?? 0,
    },
  })
}
