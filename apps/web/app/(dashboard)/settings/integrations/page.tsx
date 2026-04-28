import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getLdapConfigurations } from '@/lib/actions/ldap'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { LdapSettingsClient } from '../ldap/ldap-client'

export const metadata: Metadata = {
  title: 'Integration Settings',
}

export default async function IntegrationsSettingsPage() {
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  const orgId = session.user.organisationId!
  const configs = await getLdapConfigurations(orgId)

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'LDAP / Directory', href: '/settings/integrations' },
          { title: 'SMTP relay', href: '/settings/integrations/smtp' },
        ]}
      />
      <LdapSettingsClient orgId={orgId} initialConfigs={configs} />
    </div>
  )
}
