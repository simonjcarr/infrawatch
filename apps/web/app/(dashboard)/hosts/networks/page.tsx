import type { Metadata } from 'next'
import { listNetworks } from '@/lib/actions/networks'
import { NetworksClient } from './networks-client'

export const metadata: Metadata = {
  title: 'Networks',
}

export default async function NetworksPage() {
  const networks = await listNetworks()

  return <NetworksClient initialNetworks={networks} />
}
