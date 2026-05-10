import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listEnrolmentTokens } from '@/lib/actions/agents'
import { AgentsSettingsClient } from './agents-client'
import { redirect } from 'next/navigation'
import { AdminTabs } from '@/components/shared/admin-tabs'

export const metadata: Metadata = {
  title: 'Agent Enrolment',
}

export default async function AgentsSettingsPage() {
  const session = await getRequiredSession()

  const isAdmin =
    session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  const tokens = await listEnrolmentTokens()

  const appUrl = process.env.AGENT_DOWNLOAD_BASE_URL ?? ''

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Enrolment', href: '/settings/agents' },
          { title: 'Host defaults', href: '/settings/agents/defaults' },
          { title: 'Tag rules', href: '/settings/agents/tags' },
          { title: 'Software inventory', href: '/settings/agents/software' },
        ]}
      />
      <AgentsSettingsClient
        initialTokens={tokens}
        appUrl={appUrl}
      />
    </div>
  )
}
