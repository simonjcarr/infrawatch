import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { getTaskRun } from '@/lib/actions/task-runs'
import { TaskMonitorClient } from './task-monitor-client'

export const metadata: Metadata = {
  title: 'Task Run',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function TaskRunPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const orgId = session.user.organisationId!

  const taskRun = await getTaskRun(orgId, id)
  if (!taskRun) notFound()

  return <TaskMonitorClient orgId={orgId} initialTaskRun={taskRun} />
}
