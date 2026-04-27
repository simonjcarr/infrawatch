import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { acceptInvite } from '@/lib/actions/auth'

type AcceptInvitePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function AcceptInvitePage({ searchParams }: AcceptInvitePageProps) {
  const params = await searchParams
  const token = readParam(params.token)
  if (!token) redirect('/login?error=missing_invite_token')

  const session = await getRequiredSession()
  const result = await acceptInvite(token, session.user.id)
  if ('error' in result) {
    redirect(`/login?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/dashboard')
}
