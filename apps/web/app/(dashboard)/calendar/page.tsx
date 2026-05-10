import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { hasRole } from '@/lib/auth/guards'
import { MEMBERSHIP_ROLES } from '@/lib/auth/roles'
import { searchCalendarHosts, searchCalendarUsers } from '@/lib/actions/calendar'
import { OperationsCalendarClient } from './operations-calendar-client'

export const metadata: Metadata = {
  title: 'Operations Calendar',
}

export default async function OperationsCalendarPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId
  const canEdit = hasRole(session.user, MEMBERSHIP_ROLES)

  if (!orgId) {
    return (
      <OperationsCalendarClient
        orgId=""
        canEdit={canEdit}
        initialHosts={[]}
        initialUsers={[{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }]}
      />
    )
  }

  const [hostResult, userResult] = await Promise.all([
    searchCalendarHosts(orgId, { limit: 100 }),
    searchCalendarUsers(orgId, { limit: 100 }),
  ])

  return (
    <OperationsCalendarClient
      orgId={orgId}
      canEdit={canEdit}
      initialHosts={'hosts' in hostResult ? hostResult.hosts : []}
      initialUsers={'users' in userResult ? userResult.users : []}
    />
  )
}
