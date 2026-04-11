import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getGroup } from '@/lib/actions/host-groups'
import { listHosts } from '@/lib/actions/agents'
import { GroupDetailClient } from './group-detail-client'

export const metadata: Metadata = {
  title: 'Group Detail',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function GroupDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [group, allHosts] = await Promise.all([
    getGroup(orgId, id),
    listHosts(orgId),
  ])

  if (!group) notFound()

  return (
    <GroupDetailClient
      orgId={orgId}
      userId={session.user.id}
      initialGroup={group}
      initialAllHosts={allHosts}
    />
  )
}
