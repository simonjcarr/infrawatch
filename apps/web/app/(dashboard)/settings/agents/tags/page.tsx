import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { listTagRules } from '@/lib/actions/tag-rules'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { TagRulesClient } from '../../tag-rules/tag-rules-client'

export const metadata: Metadata = {
  title: 'Agent Tag Rules',
}

export default async function AgentTagRulesPage() {
  const session = await getRequiredSession()
  const isAdmin =
    session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const rules = await listTagRules(orgId)

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
      <TagRulesClient orgId={orgId} initialRules={rules} />
    </div>
  )
}
