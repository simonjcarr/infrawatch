import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { LoginForm } from './login-form'
import { hasLdapLoginEnabled } from '@/lib/actions/ldap'

export const metadata: Metadata = {
  title: 'Sign in',
}

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
    redirect(user?.organisationId ? '/dashboard' : '/onboarding')
  }

  const ldapEnabled = await hasLdapLoginEnabled()
  const resetComplete = readParam(params.reset) === '1'

  return (
    <LoginForm
      ldapLoginEnabled={ldapEnabled}
      notice={resetComplete ? 'Your password has been reset. Sign in with your new password.' : null}
    />
  )
}
