import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listHosts, listPendingAgents } from '@/lib/actions/agents'
import { HostsClient } from './hosts-client'

export const metadata: Metadata = {
  title: 'Hosts',
}

export default async function HostsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [hostsWithAgents, pendingAgents] = await Promise.all([
    listHosts(orgId),
    listPendingAgents(orgId),
  ])

  return (
    <HostsClient
      orgId={orgId}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      initialHosts={hostsWithAgents}
      initialPendingAgents={pendingAgents}
    />
  )
}
