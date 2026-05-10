import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SettingsClient } from './settings-client'
import { AdminTabs } from '@/components/shared/admin-tabs'

export const metadata: Metadata = {
  title: 'Organisation Settings',
}

export default async function SettingsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId

  const org = orgId
    ? await db.query.organisations.findFirst({
        where: eq(organisations.id, orgId),
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
          <h1 className="text-2xl font-semibold tracking-tight">Organisation</h1>
          <p className="text-sm text-muted-foreground">
            Organisation profile settings will be available after instance setup is complete.
          </p>
        </div>
      </div>
    )
  }

  const isAdmin = ['org_admin', 'super_admin'].includes(session.user.role)

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
        sections={['organisation']}
        title="Organisation"
        description="Manage your organisation profile."
      />
    </div>
  )
}
