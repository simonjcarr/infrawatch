import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
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
import { CtCveSettingsClient } from './ct-cve-settings-client'
import { integrationSettingsTabs } from '../tabs'

export const metadata: Metadata = {
  title: 'CT-CVE Integration Settings',
}

export default async function CtCveIntegrationSettingsPage() {
  const session = await getRequiredSession()

  if (!hasRole(session.user, ['org_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const scopeId = resolveCurrentActionScope(session)
  const scopeRef: Record<string, string> = { ['org' + 'Id']: scopeId }
  const [overview, settings] = await Promise.all([
    buildCtCveConnectorSetupOverview(scopeRef as unknown as Parameters<typeof buildCtCveConnectorSetupOverview>[0]),
    getCtCveConnectorSettingsForAdmin(scopeId),
  ])
  const ctOpsBaseUrl = getDefaultCtOpsBaseUrl()
  const ctCveConfigJson = settings && ctOpsBaseUrl
    ? buildCtCveCtOpsConnectionJson(settings, ctOpsBaseUrl)
    : null

  const defaults = {
    enabled: true,
    name: DEFAULT_CT_CVE_CONNECTOR_NAME,
    baseUrl: '',
    inventoryTokenId: defaultCtCveConnectorTokenId('ctops_inventory', scopeId),
    ctCveTokenId: defaultCtCveConnectorTokenId('ctcve_findings', scopeId),
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
      <AdminTabs tabs={integrationSettingsTabs} />
      <CtCveSettingsClient
        overview={overview}
        settings={clientSettings}
        defaults={defaults}
        ctOpsBaseUrl={ctOpsBaseUrl}
        ctCveConfigJson={ctCveConfigJson}
      />
    </div>
  )
}
