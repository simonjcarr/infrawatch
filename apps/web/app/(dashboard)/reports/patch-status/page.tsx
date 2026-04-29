import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getPatchManagementReport } from '@/lib/actions/patch-status'
import { PatchStatusReportClient } from './patch-status-report-client'

export const metadata: Metadata = {
  title: 'Patch Status Report',
}

export default async function PatchStatusReportPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const report = await getPatchManagementReport(orgId)
  return <PatchStatusReportClient report={report} />
}
