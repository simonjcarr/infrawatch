import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getEffectiveLicence } from '@/lib/actions/licence-guard'
import { hasFeature } from '@/lib/features'
import { LockedFeature } from '@/components/shared/locked-feature'
import { getPatchManagementReport } from '@/lib/actions/patch-status'
import { PatchStatusReportClient } from './patch-status-report-client'

export const metadata: Metadata = {
  title: 'Patch Status Report',
}

export default async function PatchStatusReportPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const licence = await getEffectiveLicence(orgId)
  if (!hasFeature(licence.tier, 'reportsExport')) {
    return <LockedFeature feature="reportsExport" tier={licence.tier} />
  }

  const report = await getPatchManagementReport(orgId)
  return <PatchStatusReportClient report={report} />
}
