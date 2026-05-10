import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getLdapConfigurations } from '@/lib/actions/ldap'
import { hasRole } from '@/lib/auth/guards'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { LdapSettingsClient } from '../ldap/ldap-client'

export const metadata: Metadata = {
  title: 'Integration Settings',
}

export default async function IntegrationsSettingsPage() {
  const session = await getRequiredSession()

  if (!hasRole(session.user, ['org_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const configs = await getLdapConfigurations()

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'LDAP / Directory', href: '/settings/integrations' },
          { title: 'SMTP relay', href: '/settings/integrations/smtp' },
          { title: 'CT-CVE', href: '/settings/integrations/ct-cve' },
        ]}
      />
      <LdapSettingsClient initialConfigs={configs} />
    </div>
  )
}
