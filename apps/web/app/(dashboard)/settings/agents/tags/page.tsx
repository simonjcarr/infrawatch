import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { listTagRules } from '@/lib/actions/tag-rules'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { TagRulesClient } from '../../tag-rules/tag-rules-client'
import { hasRole } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Agent Tag Rules',
}

export default async function AgentTagRulesPage() {
  const session = await getRequiredSession()
  const isAdmin = hasRole(session.user, ['instance_admin', 'super_admin'])
  if (!isAdmin) redirect('/dashboard')

  const rules = await listTagRules()

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
      <TagRulesClient initialRules={rules} />
    </div>
  )
}
