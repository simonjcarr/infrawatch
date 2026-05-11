import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getAutomationSettings } from '@/lib/actions/automation'
import { hasRole } from '@/lib/auth/guards'
import { getRequiredSession } from '@/lib/auth/session'
import { AdminTabs } from '@/components/shared/admin-tabs'
import { integrationSettingsTabs } from '../tabs'
import { AutomationSettingsClient } from './automation-settings-client'

export const metadata: Metadata = {
  title: 'Automation Integration Settings',
}

export default async function AutomationIntegrationSettingsPage() {
  const session = await getRequiredSession()

  if (!hasRole(session.user, ['org_admin', 'super_admin'])) {
    redirect('/settings')
  }

  const settings = await getAutomationSettings()

  return (
    <div className="space-y-6">
      <AdminTabs tabs={integrationSettingsTabs} />
      <AutomationSettingsClient initialSettings={settings} />
    </div>
  )
}
