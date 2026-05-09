import type { Metadata } from 'next'
import { listGroups } from '@/lib/actions/host-groups'
import { GroupsClient } from './groups-client'

export const metadata: Metadata = {
  title: 'Host Groups',
}

export default async function GroupsPage() {
  const groups = await listGroups()

  return <GroupsClient initialGroups={groups} />
}
