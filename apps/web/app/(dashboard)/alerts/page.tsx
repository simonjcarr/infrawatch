import type { Metadata } from 'next'
import { getAlertInstances, getNotificationChannels, getSilences } from '@/lib/actions/alerts'
import { listHosts } from '@/lib/actions/agents'
import { AlertsClient } from './alerts-client'

export const metadata: Metadata = {
  title: 'Alerts',
}

export default async function AlertsPage() {
  const [activeAlerts, channels, silences, hosts] = await Promise.all([
    getAlertInstances({ status: 'firing', limit: 100 }),
    getNotificationChannels(),
    getSilences(),
    listHosts(),
  ])

  return (
    <AlertsClient
      initialActive={activeAlerts}
      initialChannels={channels}
      initialSilences={silences}
      hosts={hosts}
    />
  )
}
