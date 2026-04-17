import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listEnrolmentTokens } from '@/lib/actions/agents'
import { AgentsSettingsClient } from './agents-client'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Agent Enrolment',
}

export default async function AgentsSettingsPage() {
  const session = await getRequiredSession()

  const isAdmin =
    session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const tokens = await listEnrolmentTokens(orgId)

  const appUrl = process.env.AGENT_DOWNLOAD_BASE_URL ?? ''

  return (
    <AgentsSettingsClient
      orgId={orgId}
      currentUserId={session.user.id}
      initialTokens={tokens}
      appUrl={appUrl}
    />
  )
}
