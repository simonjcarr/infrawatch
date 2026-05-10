import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getRequiredSession } from '@/lib/auth/session'
import { hasRole } from '@/lib/auth/guards'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { buildCtCveConnectorSetupOverview } from '@/lib/integrations/ct-cve/setup-status'
import {
  DEFAULT_CT_CVE_CONNECTOR_NAME,
  buildCtCveCtOpsConnectionJson,
  defaultCtCveConnectorTokenId,
  getCtCveConnectorSettingsForAdmin,
  getDefaultCtOpsBaseUrl,
} from '@/lib/integrations/ct-cve/connector-settings'
import { createEmptyCtCveConnectorSetupOverview } from '@/lib/standalone-empty-state'
import { CtCveSettingsClient } from './ct-cve-settings-client'

export const metadata: Metadata = {
  title: 'CT-CVE Integration Settings',
}

const tabs = [
  { title: 'LDAP / Directory', href: '/settings/integrations' },
  { title: 'SMTP relay', href: '/settings/integrations/smtp' },
  { title: 'CT-CVE', href: '/settings/integrations/ct-cve' },
]

export default async function CtCveIntegrationSettingsPage() {
  const session = await getRequiredSession()

  if (!hasRole(session.user, ['org_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const orgId = session.user.organisationId ?? ''
  const [overview, settings] = orgId
    ? await Promise.all([
        buildCtCveConnectorSetupOverview({ orgId }),
        getCtCveConnectorSettingsForAdmin(orgId),
      ])
    : [createEmptyCtCveConnectorSetupOverview(), null] as const
  const ctOpsBaseUrl = getDefaultCtOpsBaseUrl()
  const ctCveConfigJson = settings && ctOpsBaseUrl
    ? buildCtCveCtOpsConnectionJson(settings, ctOpsBaseUrl)
    : null

  const defaults = {
    enabled: true,
    name: DEFAULT_CT_CVE_CONNECTOR_NAME,
    baseUrl: '',
    inventoryTokenId: defaultCtCveConnectorTokenId('ctops_inventory', orgId),
    ctCveTokenId: defaultCtCveConnectorTokenId('ctcve_findings', orgId),
  }

  const clientSettings = settings ? {
    enabled: settings.enabled,
    name: settings.name,
    baseUrl: settings.baseUrl,
    inventoryTokenId: settings.inventoryTokenId,
    ctCveTokenId: settings.ctCveTokenId,
  } : null

  return (
    <div className="space-y-6">
      <AdminTabs tabs={tabs} />
      <CtCveSettingsClient
        orgId={orgId}
        overview={overview}
        settings={clientSettings}
        defaults={defaults}
        ctOpsBaseUrl={ctOpsBaseUrl}
        ctCveConfigJson={ctCveConfigJson}
      />
    </div>
  )
}
