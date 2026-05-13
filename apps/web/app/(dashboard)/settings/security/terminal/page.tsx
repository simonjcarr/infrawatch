import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { hasRole } from '@/lib/auth/guards'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'

export const metadata: Metadata = {
  title: 'Terminal Access Settings',
}

export default async function TerminalAccessSettingsPage() {
  const session = await getRequiredSession()
  if (!hasRole(session.user, ['instance_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const instanceId = session.user.instanceId
  if (!instanceId) return null

  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
  })

  if (!instance) return null

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Agent CA / mTLS', href: '/settings/security' },
          { title: 'Terminal access', href: '/settings/security/terminal' },
        ]}
      />
      <SettingsClient
        instance={instance}
        isAdmin
        sections={['terminal']}
        title="Terminal Access"
        description="Control interactive terminal access and session logging across hosts."
      />
    </div>
  )
}
