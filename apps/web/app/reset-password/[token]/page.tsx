import type { Metadata } from 'next'
import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = {
  title: 'Choose a new password',
}

type ResetPasswordPageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await params
  const query = await searchParams
  const callbackURL = readParam(query.callbackURL)

  return <ResetPasswordForm token={token} callbackURL={callbackURL} />
}
