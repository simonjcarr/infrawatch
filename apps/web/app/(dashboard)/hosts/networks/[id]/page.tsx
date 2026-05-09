import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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

  const [network, allHosts] = await Promise.all([
    getNetwork(id),
    listHosts(),
  ])

  if (!network) notFound()

  return (
    <NetworkDetailClient
      initialNetwork={network}
      initialAllHosts={allHosts}
    />
  )
}
