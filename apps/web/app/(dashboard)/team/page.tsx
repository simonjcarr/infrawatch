import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getOrgUsers } from '@/lib/actions/users'
import { TeamClient } from './team-client'

export const metadata: Metadata = {
  title: 'Team',
}

export default async function TeamPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const { members, pendingInvites } = await getOrgUsers(orgId)

  return (
    <TeamClient
      orgId={orgId}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      initialMembers={members}
      initialPendingInvites={pendingInvites}
    />
  )
}
