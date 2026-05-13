import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listGroups } from '@/lib/actions/host-groups'
import { SoftwareReportClient } from './software-report-client'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

export const metadata: Metadata = {
  title: 'Installed Software Report',
}

export default async function SoftwareReportPage() {
  await getRequiredSession()
  const groups = await listGroups()

  return (
    <NuqsAdapter>
      <SoftwareReportClient instanceName="CT-Ops" hostGroups={groups} />
    </NuqsAdapter>
  )
}
