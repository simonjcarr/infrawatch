import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
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
  const orgId = session.user.organisationId!

  const taskRun = await getTaskRun(orgId, id)
  if (!taskRun) notFound()

  return <TaskMonitorClient orgId={orgId} initialTaskRun={taskRun} />
}
