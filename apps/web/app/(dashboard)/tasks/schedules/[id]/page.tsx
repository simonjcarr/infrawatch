import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
import { listHosts } from '@/lib/actions/agents'
import { listGroups } from '@/lib/actions/host-groups'
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
  if (!ADMIN_ROLES.includes(session.user.role)) redirect('/tasks')
  const currentScope = resolveCurrentActionScope(session)

  const result = await getSchedule(currentScope, id)
  if (!result) notFound()

  const [hostRows, groupRows] = await Promise.all([
    listHosts(currentScope),
    listGroups(currentScope),
  ])

  return (
    <ScheduleForm
      mode="edit"
      hosts={hostRows}
      groups={groupRows}
      schedule={result.schedule}
      recentRuns={result.recentRuns}
    />
  )
}
