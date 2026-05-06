import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { PasswordManagerClientShell } from './password-manager-client'

export const metadata: Metadata = {
  title: 'Password Manager',
}

export default async function PasswordManagerPage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const currentUserId = session.user.id
  const organisationUsers = await db.query.users.findMany({
    where: and(eq(users.organisationId, orgId), eq(users.isActive, true), isNull(users.deletedAt)),
    orderBy: [asc(users.name), asc(users.email)],
    columns: {
      id: true,
      name: true,
      email: true,
    },
  })

  return (
    <PasswordManagerClientShell
      key={orgId}
      orgId={orgId}
      currentUserId={currentUserId}
      organisationUsers={organisationUsers}
    />
  )
}
