import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getRequireEmailVerification } from '@/lib/auth/env'
import { getInviteAcceptPath } from '@/lib/auth/invite-redirects'
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects'
import { RegisterForm } from './register-form'

export const metadata: Metadata = {
  title: 'Create account',
}

type RegisterPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams
  const inviteAcceptPath = getInviteAcceptPath(readParam(params.invite))
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
    if (inviteAcceptPath && user?.isActive && !user.deletedAt) {
      redirect(inviteAcceptPath)
    }

    const redirectPath = getAuthenticatedRedirectPath(user)
    if (redirectPath) redirect(redirectPath)
  }

  return (
    <Suspense>
      <RegisterForm requireEmailVerification={getRequireEmailVerification()} />
    </Suspense>
  )
}
