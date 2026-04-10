import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getDomainAccounts } from '@/lib/actions/domain-accounts'
import type { DomainAccountListFilters } from '@/lib/actions/domain-accounts'
import type { DomainAccountSource, DomainAccountStatus } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

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
  const filters: DomainAccountListFilters = {
    source: (searchParams.get('source') as DomainAccountSource) ?? undefined,
    status: (searchParams.get('status') as DomainAccountStatus) ?? undefined,
    search: searchParams.get('search') ?? undefined,
    sortBy: (searchParams.get('sortBy') as DomainAccountListFilters['sortBy']) ?? undefined,
    sortDir: (searchParams.get('sortDir') as 'asc' | 'desc') ?? undefined,
    limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
    offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
  }

  const accounts = await getDomainAccounts(user.organisationId, filters)
  return Response.json(accounts)
}
