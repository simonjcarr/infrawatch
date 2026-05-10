import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getDomainAccounts, getDomainAccountCounts } from '@/lib/actions/domain-accounts'
import { EMPTY_DOMAIN_ACCOUNT_COUNTS } from '@/lib/standalone-empty-state'
import { ServiceAccountsClient } from './service-accounts-client'

export const metadata: Metadata = {
  title: 'Service Accounts',
}

export default async function ServiceAccountsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId

  if (!orgId) {
    return (
      <ServiceAccountsClient
        orgId=""
        initialAccounts={[]}
        initialCounts={EMPTY_DOMAIN_ACCOUNT_COUNTS}
      />
    )
  }

  const [initialAccounts, initialCounts] = await Promise.all([
    getDomainAccounts(orgId, { sortBy: 'username', sortDir: 'asc', limit: 100 }),
    getDomainAccountCounts(orgId),
  ])

  return (
    <ServiceAccountsClient
      orgId={orgId}
      initialAccounts={initialAccounts}
      initialCounts={initialCounts}
    />
  )
}
