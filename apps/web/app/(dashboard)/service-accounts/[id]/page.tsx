import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getDomainAccount } from '@/lib/actions/domain-accounts'
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

  const account = await getDomainAccount(orgId, id)
  if (!account) notFound()

  return <ServiceAccountDetailClient orgId={orgId} account={account} />
}
