import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getGlobalAlertDefaults } from '@/lib/actions/alerts'
import { GlobalAlertsClient } from './alerts-client'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Global Alert Defaults',
}

export default async function GlobalAlertsSettingsPage() {
  const session = await getRequiredSession()

  const isAdmin = session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const defaults = await getGlobalAlertDefaults(orgId)

  return (
    <GlobalAlertsClient
      orgId={orgId}
      initialDefaults={defaults}
    />
  )
}
