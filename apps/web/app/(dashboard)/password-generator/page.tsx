import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PasswordGeneratorTool } from '@/components/password-generator/password-generator-tool'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'

export const metadata: Metadata = {
  title: 'Password Generator',
}

export default async function PasswordGeneratorPage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')

  return (
    <div className="max-w-5xl">
      <PasswordGeneratorTool />
    </div>
  )
}
