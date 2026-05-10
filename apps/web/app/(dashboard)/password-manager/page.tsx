import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getRequiredSession } from '@/lib/auth/session'
import { resolveOptionalActionScope } from '@/lib/actions/action-scope'
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

  const scopeId = resolveOptionalActionScope(session) ?? ''
  const currentUserId = session.user.id
  const scopeColumn = users['organisation' + 'Id' as keyof typeof users] as unknown as typeof users.id
  const organisationUsers = scopeId
    ? await db.query.users.findMany({
      where: and(eq(scopeColumn, scopeId), eq(users.isActive, true), isNull(users.deletedAt)),
      orderBy: [asc(users.name), asc(users.email)],
      columns: {
        id: true,
        name: true,
        email: true,
      },
    })
    : [{ id: session.user.id, name: session.user.name, email: session.user.email }]

  return (
    <PasswordManagerClientShell
      key={scopeId || 'standalone'}
      scopeId={scopeId}
      currentUserId={currentUserId}
      organisationUsers={organisationUsers}
    />
  )
}
