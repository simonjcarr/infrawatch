import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { PendingApprovalCard } from './pending-approval-card'

export const metadata: Metadata = {
  title: 'Account pending approval',
}

export default async function PendingApprovalPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user || user.role !== 'pending') redirect('/dashboard')

  return <PendingApprovalCard />
}
