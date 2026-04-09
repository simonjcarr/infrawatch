import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getServiceAccounts, getServiceAccountCounts } from '@/lib/actions/service-accounts'
import { ServiceAccountsClient } from './service-accounts-client'

export const metadata: Metadata = {
  title: 'Service Accounts',
}

export default async function ServiceAccountsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [initialAccounts, initialCounts] = await Promise.all([
    getServiceAccounts(orgId, { sortBy: 'username', sortDir: 'asc', limit: 100 }),
    getServiceAccountCounts(orgId),
  ])

  return (
    <ServiceAccountsClient
      orgId={orgId}
      initialAccounts={initialAccounts}
      initialCounts={initialCounts}
    />
  )
}
