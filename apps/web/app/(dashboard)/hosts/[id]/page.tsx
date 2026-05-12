import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getHost } from '@/lib/actions/agents'
import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
import { REQUIRED_AGENT_VERSION } from '@/lib/agent/version'
import { getAnsibleAutomationAvailability } from '@/lib/actions/automation'
import { HostDetailClient } from './host-detail-client'

export const metadata: Metadata = {
  title: 'Host Detail',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function HostDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  const scopeId = resolveCurrentActionScope(session)

  const [host, ansibleAutomation] = await Promise.all([
    getHost(id),
    getAnsibleAutomationAvailability(),
  ])
  if (!host) notFound()

  return (
    <HostDetailClient
      host={host}
      scopeId={scopeId}
      currentUserId={session.user.id}
      userRole={session.user.role}
      latestAgentVersion={REQUIRED_AGENT_VERSION}
      ansibleAutomationEnabled={ansibleAutomation.enabled}
    />
  )
}
