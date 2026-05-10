import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SettingsClient } from './settings-client'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { hasRole } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Instance Settings',
}

export default async function SettingsPage() {
  const session = await getRequiredSession()
  const instanceId = session.user.instanceId

  const org = instanceId
    ? await db.query.instanceSettings.findFirst({
        where: eq(instanceSettings.id, instanceId),
      })
    : null

  if (!org) {
    return (
      <div className="space-y-6">
        <AdminTabs
          tabs={[
            { title: 'Profile', href: '/settings' },
            { title: 'Licence', href: '/settings/licence' },
          ]}
        />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Instance</h1>
          <p className="text-sm text-muted-foreground">
            Instance profile settings will be available after setup is complete.
          </p>
        </div>
      </div>
    )
  }

  const isAdmin = hasRole(session.user, ['org_admin', 'super_admin'])

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Profile', href: '/settings' },
          { title: 'Licence', href: '/settings/licence' },
        ]}
      />
      <SettingsClient
        org={org}
        isAdmin={isAdmin}
        sections={['instance']}
        title="Instance"
        description="Manage your instance profile."
      />
    </div>
  )
}
