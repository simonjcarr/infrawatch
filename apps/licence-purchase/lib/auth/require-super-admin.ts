import { redirect } from 'next/navigation'
import { getOptionalSession } from './session'
import type { User } from '@/lib/db/schema'

// Use inside admin layouts / pages. Non-super-admins land on /.
export async function requireSuperAdmin(): Promise<{ user: User }> {
  const session = await getOptionalSession()
  if (!session || session.user.role !== 'super_admin') {
    redirect('/')
  }
  return { user: session.user }
}

// Use inside server actions. Throws so the action can surface an error rather
// than triggering a navigation side-effect.
export async function assertSuperAdmin(): Promise<{ user: User }> {
  const session = await getOptionalSession()
  if (!session || session.user.role !== 'super_admin') {
    throw new Error('Forbidden: super_admin role required')
  }
  return { user: session.user }
}
