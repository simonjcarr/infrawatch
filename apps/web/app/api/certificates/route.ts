import { NextRequest } from 'next/server'
import { getCertificates } from '@/lib/actions/certificates'
import type { CertificateListFilters } from '@/lib/actions/certificates'
import type { CertificateStatus } from '@/lib/db/schema'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/certificates?status=valid&host=foo&sortBy=not_after&sortDir=asc&limit=100&offset=0
export async function GET(request: NextRequest) {
  let session
  try {
    session = await getApiOrgSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
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

  try {
    const certificates = await getCertificates(session.user.organisationId, filters)
    return Response.json(certificates)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
