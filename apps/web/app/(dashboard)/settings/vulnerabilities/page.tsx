import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { VulnerabilityManagementClient } from './vulnerability-management-client'

export const metadata: Metadata = {
  title: 'Vulnerability Management',
}

export default async function VulnerabilityManagementPage() {
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  return <VulnerabilityManagementClient orgId={session.user.organisationId!} />
}
