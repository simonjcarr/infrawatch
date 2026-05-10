import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getOrgUsers } from '@/lib/actions/users'
import { TeamClient } from './team-client'

export const metadata: Metadata = {
  title: 'People',
}

export default async function TeamPage() {
  const session = await getRequiredSession()
  const { members, pendingInvites } = await getOrgUsers()

  return (
    <TeamClient
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      initialMembers={members}
      initialPendingInvites={pendingInvites}
    />
  )
}
