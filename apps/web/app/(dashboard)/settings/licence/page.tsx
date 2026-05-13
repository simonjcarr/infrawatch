import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { instanceSettings, parseInstanceMetadata, users } from '@/lib/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { SettingsClient } from '../settings-client'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { getEffectiveLicence } from '@/lib/actions/licence-guard'
import { getInstanceSeatUsage } from '@/lib/actions/seat-enforcement'
import { createCommunityLicence } from '@/lib/standalone-empty-state'
import { hasRole } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Licence Settings',
}

export default async function LicenceSettingsPage() {
  const session = await getRequiredSession()
  const instanceId = session.user.instanceId

  if (!instanceId) {
    const effectiveLicence = createCommunityLicence()
    return (
      <div className="space-y-6">
        <AdminTabs
          tabs={[
            { title: 'Profile', href: '/settings' },
            { title: 'Licence', href: '/settings/licence' },
          ]}
        />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Licence</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This standalone instance is running on the Community licence.
          </p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Current tier</p>
          <p className="text-2xl font-semibold capitalize">{effectiveLicence.tier}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {effectiveLicence.maxUsers} included user seats.
          </p>
        </div>
      </div>
    )
  }

  const [instance, activeUsers, effectiveLicence, seatUsage] = await Promise.all([
    db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
    }),
    db.query.users.findMany({
      where: and(eq(users.instanceId, instanceId), eq(users.isActive, true), isNull(users.deletedAt)),
      columns: { id: true, name: true, email: true, role: true, roles: true },
      orderBy: [asc(users.createdAt), asc(users.email)],
    }),
    getEffectiveLicence(instanceId),
    getInstanceSeatUsage(instanceId),
  ])

  if (!instance) return null

  const isAdmin = hasRole(session.user, ['instance_admin', 'super_admin'])

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Profile', href: '/settings' },
          { title: 'Licence', href: '/settings/licence' },
        ]}
      />
      <SettingsClient
        instance={instance}
        isAdmin={isAdmin}
        sections={['licence']}
        title="Licence"
        description="Manage seats, licence expiry, and Enterprise capabilities."
        effectiveLicence={{
          tier: effectiveLicence.tier,
          maxUsers: effectiveLicence.maxUsers,
          expiresAt: effectiveLicence.expiresAt?.toISOString(),
        }}
        seatUsage={seatUsage}
        freeSeatUsers={{
          users: activeUsers,
          selectedUserIds: parseInstanceMetadata(instance.metadata).freeSeatUserIds ?? [],
        }}
      />
    </div>
  )
}
