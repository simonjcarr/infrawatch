import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { hostGroups } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getEffectiveLicence } from '@/lib/actions/licence-guard'
import { hasFeature } from '@/lib/features'
import { LockedFeature } from '@/components/shared/locked-feature'
import { VulnerabilityReportClient } from './vulnerability-report-client'

export const metadata: Metadata = {
  title: 'Vulnerability Report',
}

export default async function VulnerabilityReportPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const licence = await getEffectiveLicence(orgId)
  if (!hasFeature(licence.tier, 'reportsExport')) {
    return <LockedFeature feature="reportsExport" tier={licence.tier} />
  }

  const groups = await db.query.hostGroups.findMany({
    where: and(eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
    columns: { id: true, name: true },
    orderBy: hostGroups.name,
  })

  return <VulnerabilityReportClient orgId={orgId} hostGroups={groups} />
}

