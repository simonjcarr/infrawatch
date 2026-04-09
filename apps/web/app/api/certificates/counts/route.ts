import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCertificateCounts } from '@/lib/actions/certificates'

export const dynamic = 'force-dynamic'

// GET /api/certificates/counts
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

  const counts = await getCertificateCounts(user.organisationId)
  return Response.json(counts)
}
