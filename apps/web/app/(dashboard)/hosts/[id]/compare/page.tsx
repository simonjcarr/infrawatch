import { getRequiredSession } from '@/lib/auth/session'
import { CompareHostsClient } from './compare-client'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ with?: string }>
}

export default async function CompareHostsPage({ params, searchParams }: Props) {
  const session = await getRequiredSession()
  const { id: hostIdA } = await params
  const { with: hostIdB = '' } = await searchParams
  const orgId = session.user.organisationId!

  return <CompareHostsClient orgId={orgId} hostIdA={hostIdA} hostIdB={hostIdB} />
}
