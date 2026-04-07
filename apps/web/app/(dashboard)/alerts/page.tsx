import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getAlertInstances, getNotificationChannels, getSilences } from '@/lib/actions/alerts'
import { listHosts } from '@/lib/actions/agents'
import { AlertsClient } from './alerts-client'

export const metadata: Metadata = {
  title: 'Alerts',
}

export default async function AlertsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [activeAlerts, recentAlerts, channels, silences, hosts] = await Promise.all([
    getAlertInstances(orgId, { status: 'firing', limit: 100 }),
    getAlertInstances(orgId, { limit: 50 }),
    getNotificationChannels(orgId),
    getSilences(orgId),
    listHosts(orgId),
  ])

  return (
    <AlertsClient
      orgId={orgId}
      currentUserId={session.user.id}
      initialActive={activeAlerts}
      initialRecent={recentAlerts}
      initialChannels={channels}
      initialSilences={silences}
      hosts={hosts}
    />
  )
}
