import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SettingsClient } from '../settings-client'
import { AdminTabs } from '@/components/shared/admin-tabs'

export const metadata: Metadata = {
  title: 'Licence Settings',
}

export default async function LicenceSettingsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
  })

  if (!org) return null

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
        sections={['licence']}
        title="Organisation"
        description="Manage your licence and feature tier."
      />
    </div>
  )
}
