import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getDomainAccounts, getDomainAccountCounts } from '@/lib/actions/domain-accounts'
import { DirectoryAccountsClient } from './directory-accounts-client'

export const metadata: Metadata = {
  title: 'Directory Accounts',
}

export default async function DirectoryAccountsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [initialAccounts, initialCounts] = await Promise.all([
    getDomainAccounts(orgId, { sortBy: 'username', sortDir: 'asc', limit: 100 }),
    getDomainAccountCounts(orgId),
  ])

  return (
    <DirectoryAccountsClient
      orgId={orgId}
      initialAccounts={initialAccounts}
      initialCounts={initialCounts}
    />
  )
}
