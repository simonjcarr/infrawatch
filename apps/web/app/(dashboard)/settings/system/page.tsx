import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { hasRole } from '@/lib/auth/guards'
import { SystemHealthClient } from './system-client'

export const metadata: Metadata = {
  title: 'System Health',
}

export default async function SystemHealthPage() {
  const session = await getRequiredSession()
  const isAdmin = hasRole(session.user, ['instance_admin', 'super_admin'])
  if (!isAdmin) redirect('/dashboard')

  return <SystemHealthClient />
}
