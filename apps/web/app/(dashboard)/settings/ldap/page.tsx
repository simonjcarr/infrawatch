import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getLdapConfigurations } from '@/lib/actions/ldap'
import { LdapSettingsClient } from './ldap-client'
import { ADMIN_ROLES } from '@/lib/auth/roles'

export const metadata: Metadata = {
  title: 'LDAP / Directory Settings',
}

export default async function LdapSettingsPage() {
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/settings')
  }

  const orgId = session.user.organisationId!
  const configs = await getLdapConfigurations(orgId)

  return <LdapSettingsClient orgId={orgId} initialConfigs={configs} />
}
