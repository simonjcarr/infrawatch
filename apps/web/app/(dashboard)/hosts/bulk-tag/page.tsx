import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { BulkTagClient } from './bulk-tag-client'

export const metadata: Metadata = {
  title: 'Bulk Tag Hosts',
}

export default async function BulkTagPage() {
  const session = await getRequiredSession()
  const isAdmin =
    session.user.role === 'super_admin' || session.user.role === 'org_admin' || session.user.role === 'engineer'
  if (!isAdmin) redirect('/dashboard')

  return <BulkTagClient instanceId={session.user.instanceId!} />
}
