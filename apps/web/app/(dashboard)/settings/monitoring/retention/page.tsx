import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'

export const metadata: Metadata = {
  title: 'Metric Retention Settings',
}

export default async function MetricRetentionSettingsPage() {
  const session = await getRequiredSession()
  const isAdmin = ['org_admin', 'super_admin'].includes(session.user.role)
  if (!isAdmin) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
  })

  if (!org) return null

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
        org={org}
        isAdmin={isAdmin}
        sections={['retention']}
        title="Metric Retention"
        description="Set how long raw monitoring data is kept."
      />
    </div>
  )
}
