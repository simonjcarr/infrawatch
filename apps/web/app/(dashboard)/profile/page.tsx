import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { ProfileClient } from './profile-client'

export const metadata: Metadata = {
  title: 'Profile',
}

export default async function ProfilePage() {
  const session = await getRequiredSession()
  return <ProfileClient user={session.user} orgId={session.user.organisationId ?? ''} />
}
