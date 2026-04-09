import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getServiceAccount } from '@/lib/actions/service-accounts'
import { ServiceAccountDetailClient } from './service-account-detail-client'

export const metadata: Metadata = {
  title: 'Service Account Detail',
}

export default async function ServiceAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const { id } = await params

  const result = await getServiceAccount(orgId, id)
  if (!result) notFound()

  return (
    <ServiceAccountDetailClient
      orgId={orgId}
      account={result.account}
      keys={result.keys}
      events={result.events}
      host={result.host}
    />
  )
}
