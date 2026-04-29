import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { db } from '@/lib/db'
import { hosts, hostGroups } from '@/lib/db/schema'
import { and, eq, isNull, asc } from 'drizzle-orm'
import { ScheduleForm } from '../schedule-form'

export const metadata: Metadata = {
  title: 'New Schedule',
}

export default async function NewSchedulePage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const orgId = session.user.organisationId!

  const [hostRows, groupRows] = await Promise.all([
    db.query.hosts.findMany({
      where: and(eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
      columns: { id: true, hostname: true, os: true },
      orderBy: asc(hosts.hostname),
    }),
    db.query.hostGroups.findMany({
      where: and(eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
      columns: { id: true, name: true },
      orderBy: asc(hostGroups.name),
    }),
  ])

  return (
    <ScheduleForm
      orgId={orgId}
      mode="create"
      hosts={hostRows}
      groups={groupRows}
    />
  )
}
