import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCertificates } from '@/lib/actions/certificates'
import type { CertificateListFilters } from '@/lib/actions/certificates'
import type { CertificateStatus } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// GET /api/certificates?status=valid&host=foo&sortBy=not_after&sortDir=asc&limit=100&offset=0
export async function GET(request: NextRequest) {
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

  const { searchParams } = request.nextUrl
  const filters: CertificateListFilters = {
    status: (searchParams.get('status') as CertificateStatus) ?? undefined,
    host: searchParams.get('host') ?? undefined,
    sortBy: (searchParams.get('sortBy') as CertificateListFilters['sortBy']) ?? undefined,
    sortDir: (searchParams.get('sortDir') as 'asc' | 'desc') ?? undefined,
    limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
    offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
  }

  const certificates = await getCertificates(user.organisationId, filters)
  return Response.json(certificates)
}
