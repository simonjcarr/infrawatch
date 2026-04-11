import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { listGroups } from '@/lib/actions/host-groups'
import { GroupsClient } from './groups-client'

export const metadata: Metadata = {
  title: 'Host Groups',
}

export default async function GroupsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const groups = await listGroups(orgId)

  return <GroupsClient orgId={orgId} initialGroups={groups} />
}
