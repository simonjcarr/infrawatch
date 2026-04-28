import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getGlobalAlertDefaults } from '@/lib/actions/alerts'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { GlobalAlertsClient } from '../alerts/alerts-client'

export const metadata: Metadata = {
  title: 'Monitoring Settings',
}

export default async function MonitoringSettingsPage() {
  const session = await getRequiredSession()
  const isAdmin = session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const defaults = await getGlobalAlertDefaults(orgId)

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Alert defaults', href: '/settings/monitoring' },
          { title: 'Notifications', href: '/settings/monitoring/notifications' },
          { title: 'Metric retention', href: '/settings/monitoring/retention' },
        ]}
      />
      <GlobalAlertsClient orgId={orgId} initialDefaults={defaults} />
    </div>
  )
}
