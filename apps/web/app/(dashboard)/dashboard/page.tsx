import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getInstanceDisplayName } from '@/lib/instance-display-name'
import { DashboardClient } from './dashboard-client'

export async function generateMetadata(): Promise<Metadata> {
  const session = await getRequiredSession()
  const instanceName = await getInstanceDisplayName(session.user.instanceId)

  return {
    title: {
      absolute: `Overview | ${instanceName}`,
    },
  }
}

export default async function DashboardPage() {
  const session = await getRequiredSession()
  const instanceName = await getInstanceDisplayName(session.user.instanceId)

  return <DashboardClient instanceName={instanceName} />
}
