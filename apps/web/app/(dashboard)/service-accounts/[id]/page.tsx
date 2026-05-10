import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
  const { id } = await params

  const account = await getDomainAccount(id)
  if (!account) notFound()

  return <ServiceAccountDetailClient account={account} />
}
