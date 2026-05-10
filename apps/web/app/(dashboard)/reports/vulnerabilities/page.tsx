import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listGroups } from '@/lib/actions/host-groups'
import { VulnerabilityReportClient } from './vulnerability-report-client'

export const metadata: Metadata = {
  title: 'Vulnerability Report',
}

export default async function VulnerabilityReportPage() {
  await getRequiredSession()
  const groups = await listGroups()

  return <VulnerabilityReportClient hostGroups={groups} />
}
