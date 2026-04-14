import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations, hostGroups } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { SoftwareReportClient } from './software-report-client'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

export const metadata: Metadata = {
  title: 'Installed Software Report',
}

export default async function SoftwareReportPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [org, groups] = await Promise.all([
    db.query.organisations.findFirst({
      where: and(eq(organisations.id, orgId), isNull(organisations.deletedAt)),
      columns: { id: true, name: true },
    }),
    db.query.hostGroups.findMany({
      where: and(eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
      columns: { id: true, name: true },
      orderBy: hostGroups.name,
    }),
  ])

  if (!org) return null

  return (
    <NuqsAdapter>
      <SoftwareReportClient orgId={orgId} orgName={org.name} hostGroups={groups} />
    </NuqsAdapter>
  )
}
