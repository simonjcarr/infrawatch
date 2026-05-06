import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getPendingInviteForEmail } from '@/lib/actions/auth'
import { getInviteAcceptPath } from '@/lib/auth/invite-redirects'
import { OnboardingForm } from './onboarding-form'

export const metadata: Metadata = {
  title: 'Create your organisation',
}

type OnboardingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  // Better Auth doesn't include our extended fields in session.user —
  // fetch the full user from DB to check organisationId reliably.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (user?.organisationId) redirect('/dashboard')
  if (user?.email && !readParam(params.inviteError)) {
    const invite = await getPendingInviteForEmail(user.email)
    const inviteAcceptPath = getInviteAcceptPath(invite?.token)
    if (inviteAcceptPath) redirect(inviteAcceptPath)
  }

  return <OnboardingForm />
}
