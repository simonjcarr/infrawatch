import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getServiceAccount } from '@/lib/actions/service-accounts'
import { LocalUserDetailClient } from './local-user-detail-client'

export const metadata: Metadata = {
  title: 'Local User Detail',
}

export default async function LocalUserDetailPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>
}) {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const { id: hostId, accountId } = await params

  const result = await getServiceAccount(orgId, accountId)
  if (!result) notFound()

  return (
    <LocalUserDetailClient
      orgId={orgId}
      hostId={hostId}
      account={result.account}
      keys={result.keys}
      events={result.events}
      host={result.host}
    />
  )
}
