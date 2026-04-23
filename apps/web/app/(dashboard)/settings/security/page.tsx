import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getSecurityOverview } from '@/lib/actions/security'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { SecuritySettingsClient } from './security-client'

export const metadata: Metadata = {
  title: 'Security — mTLS & Agent CA',
}

export default async function SecuritySettingsPage() {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  const overview = await getSecurityOverview()

  return <SecuritySettingsClient initialOverview={overview} />
}
