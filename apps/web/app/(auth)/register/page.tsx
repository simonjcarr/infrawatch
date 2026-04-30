import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getRequireEmailVerification } from '@/lib/auth/env'
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects'
import { RegisterForm } from './register-form'

export const metadata: Metadata = {
  title: 'Create account',
}

export default async function RegisterPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
    const redirectPath = getAuthenticatedRedirectPath(user)
    if (redirectPath) redirect(redirectPath)
  }

  return (
    <Suspense>
      <RegisterForm requireEmailVerification={getRequireEmailVerification()} />
    </Suspense>
  )
}
