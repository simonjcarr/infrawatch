import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { OnboardingForm } from './onboarding-form'

export const metadata: Metadata = {
  title: 'Create your organisation',
}

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  // Better Auth doesn't include our extended fields in session.user —
  // fetch the full user from DB to check organisationId reliably.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (user?.organisationId) redirect('/dashboard')

  return <OnboardingForm />
}
