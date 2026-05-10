import type { Metadata } from 'next'
import { getPatchManagementReport } from '@/lib/actions/patch-status'
import { PatchStatusReportClient } from './patch-status-report-client'

export const metadata: Metadata = {
  title: 'Patch Status Report',
}

export default async function PatchStatusReportPage() {
  const report = await getPatchManagementReport()
  return <PatchStatusReportClient report={report} />
}
