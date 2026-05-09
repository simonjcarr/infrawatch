import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import {
  listHostsPaginated,
  listPendingAgents,
  listDistinctHostOses,
  getHostInventoryStats,
} from '@/lib/actions/agents'
import { HostsClient } from './hosts-client'

export const metadata: Metadata = {
  title: 'Hosts',
}

export default async function HostsPage() {
  const session = await getRequiredSession()

  const [hostPage, pendingAgents, stats, osOptions] = await Promise.all([
    listHostsPaginated({ limit: 50, offset: 0, sortBy: 'hostname', sortDir: 'asc' }),
    listPendingAgents(),
    getHostInventoryStats(),
    listDistinctHostOses(),
  ])

  return (
    <HostsClient
      currentUserRole={session.user.role}
      initialHostPage={hostPage}
      initialStats={stats}
      initialOsOptions={osOptions}
      initialPendingAgents={pendingAgents}
    />
  )
}
