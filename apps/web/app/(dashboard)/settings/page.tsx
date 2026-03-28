import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SettingsClient } from './settings-client'

export const metadata: Metadata = {
  title: 'Settings',
}

export default async function SettingsPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
  })

  if (!org) return null

  const isAdmin = ['org_admin', 'super_admin'].includes(session.user.role)

  return <SettingsClient org={org} isAdmin={isAdmin} />
}
