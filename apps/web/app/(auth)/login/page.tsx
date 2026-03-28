import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
    redirect(user?.organisationId ? '/dashboard' : '/onboarding')
  }

  return <LoginForm />
}
