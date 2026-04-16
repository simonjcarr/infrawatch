import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getNetwork } from '@/lib/actions/networks'
import { listHosts } from '@/lib/actions/agents'
import { NetworkDetailClient } from './network-detail-client'

export const metadata: Metadata = {
  title: 'Network Detail',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function NetworkDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [network, allHosts] = await Promise.all([
    getNetwork(orgId, id),
    listHosts(orgId),
  ])

  if (!network) notFound()

  return (
    <NetworkDetailClient
      orgId={orgId}
      initialNetwork={network}
      initialAllHosts={allHosts}
    />
  )
}
