import type { Metadata } from 'next'
import { getDomainAccounts, getDomainAccountCounts } from '@/lib/actions/domain-accounts'
import { ServiceAccountsClient } from './service-accounts-client'

export const metadata: Metadata = {
  title: 'Service Accounts',
}

export default async function ServiceAccountsPage() {
  const [initialAccounts, initialCounts] = await Promise.all([
    getDomainAccounts({ sortBy: 'username', sortDir: 'asc', limit: 100 }),
    getDomainAccountCounts(),
  ])

  return (
    <ServiceAccountsClient
      initialAccounts={initialAccounts}
      initialCounts={initialCounts}
    />
  )
}
