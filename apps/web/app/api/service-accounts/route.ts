import { NextRequest } from 'next/server'
import { getServiceAccounts } from '@/lib/actions/service-accounts'
import type { ServiceAccountListFilters } from '@/lib/actions/service-accounts'
import type { ServiceAccountStatus, ServiceAccountType } from '@/lib/db/schema'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/service-accounts?accountType=human&status=active&hostId=xxx&search=deploy&sortBy=username&sortDir=asc&limit=100&offset=0
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
  const filters: ServiceAccountListFilters = {
    accountType: (searchParams.get('accountType') as ServiceAccountType) ?? undefined,
    status: (searchParams.get('status') as ServiceAccountStatus) ?? undefined,
    hostId: searchParams.get('hostId') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    sortBy: (searchParams.get('sortBy') as ServiceAccountListFilters['sortBy']) ?? undefined,
    sortDir: (searchParams.get('sortDir') as 'asc' | 'desc') ?? undefined,
    limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
    offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
  }

  try {
    const accounts = await getServiceAccounts(session.user.organisationId, filters)
    return Response.json(accounts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
