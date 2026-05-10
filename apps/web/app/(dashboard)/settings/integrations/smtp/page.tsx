import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { SettingsClient } from '../../settings-client'
import { hasRole } from '@/lib/auth/guards'
import { getCurrentOrganisationSettingsRecord } from '@/lib/actions/settings'

export const metadata: Metadata = {
  title: 'SMTP Relay Settings',
}

export default async function SmtpRelaySettingsPage() {
  const session = await getRequiredSession()
  const isAdmin = hasRole(session.user, ['org_admin', 'super_admin'])
  if (!isAdmin) redirect('/dashboard')

  const org = await getCurrentOrganisationSettingsRecord()

  if (!org) {
    return (
      <div className="space-y-6">
        <AdminTabs
          tabs={[
            { title: 'LDAP / Directory', href: '/settings/integrations' },
            { title: 'SMTP relay', href: '/settings/integrations/smtp' },
            { title: 'CT-CVE', href: '/settings/integrations/ct-cve' },
          ]}
        />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">SMTP Relay</h1>
          <p className="text-sm text-muted-foreground">
            SMTP relay settings will be available after instance setup is complete.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminTabs
        tabs={[
          { title: 'LDAP / Directory', href: '/settings/integrations' },
          { title: 'SMTP relay', href: '/settings/integrations/smtp' },
          { title: 'CT-CVE', href: '/settings/integrations/ct-cve' },
        ]}
      />
      <SettingsClient
        org={org}
        isAdmin={isAdmin}
        sections={['smtp']}
        title="SMTP Relay"
        description="Configure central email delivery for notification channels."
      />
    </div>
  )
}
