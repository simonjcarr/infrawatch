import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getSecurityOverview } from '@/lib/actions/security'
import { hasRole } from '@/lib/auth/guards'
import { SecuritySettingsClient } from './security-client'
import { AdminTabs } from '@/components/shared/admin-tabs'

export const metadata: Metadata = {
  title: 'Security — mTLS & Agent CA',
}

export default async function SecuritySettingsPage() {
  const session = await getRequiredSession()
  if (!hasRole(session.user, ['org_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const overview = await getSecurityOverview()

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'Agent CA / mTLS', href: '/settings/security' },
          { title: 'Terminal access', href: '/settings/security/terminal' },
        ]}
      />
      <SecuritySettingsClient initialOverview={overview} />
    </div>
  )
}
