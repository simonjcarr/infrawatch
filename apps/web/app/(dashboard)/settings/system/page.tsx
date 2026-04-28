import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { SystemHealthClient } from './system-client'

export const metadata: Metadata = {
  title: 'System Health',
}

export default async function SystemHealthPage() {
  const session = await getRequiredSession()
  const isAdmin = session.user.role === 'super_admin' || session.user.role === 'org_admin'
  if (!isAdmin) redirect('/dashboard')

  return <SystemHealthClient />
}
