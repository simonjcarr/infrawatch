import { redirect } from 'next/navigation'

type VerifyEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams
  const token = readParam(params.token)
  const callbackURL = readParam(params.callbackURL) ?? '/login?verified=1'

  if (!token) {
    redirect('/login?error=missing_verification_token')
  }

  const target = new URL('/api/auth/verify-email', process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000')
  target.searchParams.set('token', token)
  target.searchParams.set('callbackURL', callbackURL)
  redirect(target.toString())
}
