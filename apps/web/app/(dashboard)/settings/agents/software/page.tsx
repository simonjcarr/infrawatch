import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getCurrentOrganisationSettingsRecord } from '@/lib/actions/settings'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'

export const metadata: Metadata = {
  title: 'Software Inventory Settings',
}

export default async function SoftwareInventorySettingsPage() {
  const session = await getRequiredSession()
  const isAdmin = ['org_admin', 'super_admin'].includes(session.user.role)
  if (!isAdmin) redirect('/dashboard')

  const org = await getCurrentOrganisationSettingsRecord()

  if (!org) return null

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
      <SettingsClient
        org={org}
        isAdmin={isAdmin}
        sections={['software']}
        title="Software Inventory"
        description="Control installed software scans performed by enrolled agents."
      />
    </div>
  )
}
