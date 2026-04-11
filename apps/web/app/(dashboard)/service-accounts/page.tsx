import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getDomainAccounts, getDomainAccountCounts, getLdapConfigOptions } from '@/lib/actions/domain-accounts'
import { ServiceAccountsClient } from './service-accounts-client'

export const metadata: Metadata = {
  title: 'Service Accounts',
}

export default async function ServiceAccountsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [initialAccounts, initialCounts, ldapConfigs] = await Promise.all([
    getDomainAccounts(orgId, { sortBy: 'username', sortDir: 'asc', limit: 100 }),
    getDomainAccountCounts(orgId),
    getLdapConfigOptions(orgId),
  ])

  return (
    <ServiceAccountsClient
      orgId={orgId}
      initialAccounts={initialAccounts}
      initialCounts={initialCounts}
      ldapConfigs={ldapConfigs}
    />
  )
}
