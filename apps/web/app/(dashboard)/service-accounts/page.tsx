import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getDomainAccounts, getDomainAccountCounts } from '@/lib/actions/domain-accounts'
import { getEffectiveLicence } from '@/lib/actions/licence-guard'
import { hasFeature } from '@/lib/features'
import { LockedFeature } from '@/components/shared/locked-feature'
import { ServiceAccountsClient } from './service-accounts-client'

export const metadata: Metadata = {
  title: 'Service Accounts',
}

export default async function ServiceAccountsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const licence = await getEffectiveLicence(orgId)
  if (!hasFeature(licence.tier, 'serviceAccountTracker')) {
    return <LockedFeature feature="serviceAccountTracker" tier={licence.tier} />
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
