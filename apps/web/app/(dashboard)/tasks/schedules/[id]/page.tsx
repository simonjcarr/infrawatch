import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { db } from '@/lib/db'
import { hosts, hostGroups } from '@/lib/db/schema'
import { and, eq, isNull, asc } from 'drizzle-orm'
import { getSchedule } from '@/lib/actions/task-schedules'
import { ScheduleForm } from '../schedule-form'

export const metadata: Metadata = {
  title: 'Schedule',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function SchedulePage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const orgId = session.user.organisationId!

  const result = await getSchedule(orgId, id)
  if (!result) notFound()

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
      mode="edit"
      hosts={hostRows}
      groups={groupRows}
      schedule={result.schedule}
      recentRuns={result.recentRuns}
    />
  )
}
