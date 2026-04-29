import { NextRequest } from 'next/server'
import { getDomainAccounts } from '@/lib/actions/domain-accounts'
import type { DomainAccountListFilters } from '@/lib/actions/domain-accounts'
import type { DomainAccountStatus } from '@/lib/db/schema'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

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
  const filters: DomainAccountListFilters = {
    status: (searchParams.get('status') as DomainAccountStatus) ?? undefined,
    search: searchParams.get('search') ?? undefined,
    sortBy: (searchParams.get('sortBy') as DomainAccountListFilters['sortBy']) ?? undefined,
    sortDir: (searchParams.get('sortDir') as 'asc' | 'desc') ?? undefined,
    limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
    offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
  }

  try {
    const accounts = await getDomainAccounts(session.user.organisationId, filters)
    return Response.json(accounts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
