import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, isNull, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { hosts } from '@/lib/db/schema'
import { deleteHost } from '@/lib/actions/agents'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  hostnamePrefix: z
    .string()
    .min(1)
    .max(200)
    .regex(/^loadtest-/, "hostnamePrefix must start with 'loadtest-'"),
})

// POST /api/admin/hosts/bulk-delete
// Admin-key-gated endpoint used by the `infrawatch-loadtest cleanup` CLI to
// remove all virtual hosts registered by a prior load-test run. Runs the same
// deleteHost() cascade used elsewhere in the app so any FK added in future is
// handled automatically.
export async function POST(request: NextRequest) {
  const configuredKey = process.env.INFRAWATCH_LOADTEST_ADMIN_KEY
  if (!configuredKey) {
    return Response.json(
      { error: 'Load-test admin endpoint is disabled (INFRAWATCH_LOADTEST_ADMIN_KEY not set)' },
      { status: 503 },
    )
  }
  const presented = request.headers.get('x-loadtest-admin-key')
  if (!presented || presented !== configuredKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { hostnamePrefix } = parsed.data

  const matching = await db
    .select({ id: hosts.id, organisationId: hosts.organisationId, hostname: hosts.hostname })
    .from(hosts)
    .where(and(like(hosts.hostname, `${hostnamePrefix}%`), isNull(hosts.deletedAt)))

  const failed: string[] = []
  let deleted = 0
  for (const h of matching) {
    const result = await deleteHost(h.organisationId, h.id)
    if ('error' in result) {
      failed.push(`${h.hostname}: ${result.error}`)
    } else {
      deleted++
    }
  }

  return Response.json({ deleted, failed })
}
