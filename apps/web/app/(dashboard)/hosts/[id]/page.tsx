import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getHost } from '@/lib/actions/agents'
import { HostDetailClient } from './host-detail-client'

export const metadata: Metadata = {
  title: 'Host Detail',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function HostDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const host = await getHost(orgId, id)
  if (!host) notFound()

  return <HostDetailClient host={host} orgId={orgId} />
}
