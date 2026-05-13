import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'
import { getCurrentInstanceSettingsRecord } from '@/lib/actions/settings'
import { hasRole } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Metric Retention Settings',
}

export default async function MetricRetentionSettingsPage() {
  const session = await getRequiredSession()
  const isAdmin = hasRole(session.user, ['instance_admin', 'super_admin'])
  if (!isAdmin) redirect('/dashboard')

  const instance = await getCurrentInstanceSettingsRecord()

  if (!instance) return null

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Alert defaults', href: '/settings/monitoring' },
          { title: 'Notifications', href: '/settings/monitoring/notifications' },
          { title: 'Metric retention', href: '/settings/monitoring/retention' },
        ]}
      />
      <SettingsClient
        instance={instance}
        isAdmin={isAdmin}
        sections={['retention']}
        title="Metric Retention"
        description="Set how long raw monitoring data is kept."
      />
    </div>
  )
}
