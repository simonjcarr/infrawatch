import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { PasswordManagerClientShell } from './password-manager-client'

export const metadata: Metadata = {
  title: 'Password Manager',
}

export default async function PasswordManagerPage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')

  const orgId = session.user.organisationId!
  const currentUserId = session.user.id

  return <PasswordManagerClientShell key={orgId} orgId={orgId} currentUserId={currentUserId} />
}
