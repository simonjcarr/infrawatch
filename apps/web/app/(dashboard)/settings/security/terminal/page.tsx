import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'

export const metadata: Metadata = {
  title: 'Terminal Access Settings',
}

export default async function TerminalAccessSettingsPage() {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  const orgId = session.user.organisationId!
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
  })

  if (!org) return null

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Agent CA / mTLS', href: '/settings/security' },
          { title: 'Terminal access', href: '/settings/security/terminal' },
        ]}
      />
      <SettingsClient
        org={org}
        isAdmin
        sections={['terminal']}
        title="Terminal Access"
        description="Control interactive terminal access and session logging across hosts."
      />
    </div>
  )
}
