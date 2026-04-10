import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SetupEmailForm } from './setup-email-form'

export const metadata: Metadata = {
  title: 'Set your email address',
}

export default async function SetupEmailPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user || !user.email.endsWith('@ldap.local')) redirect('/dashboard')

  return <SetupEmailForm userId={user.id} username={user.name} />
}
