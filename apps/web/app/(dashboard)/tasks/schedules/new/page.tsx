import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { listHosts } from '@/lib/actions/agents'
import { listGroups } from '@/lib/actions/host-groups'
import { ScheduleForm } from '../schedule-form'

export const metadata: Metadata = {
  title: 'New Schedule',
}

export default async function NewSchedulePage() {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) redirect('/tasks')

  const [hostRows, groupRows] = await Promise.all([
    listHosts(),
    listGroups(),
  ])

  return (
    <ScheduleForm
      mode="create"
      hosts={hostRows}
      groups={groupRows}
    />
  )
}
