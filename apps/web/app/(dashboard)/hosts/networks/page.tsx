import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listNetworks } from '@/lib/actions/networks'
import { NetworksClient } from './networks-client'

export const metadata: Metadata = {
  title: 'Networks',
}

export default async function NetworksPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const networks = await listNetworks(orgId)

  return <NetworksClient orgId={orgId} initialNetworks={networks} />
}
