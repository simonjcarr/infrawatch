import { CompareHostsClient } from './compare-client'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ with?: string }>
}

export default async function CompareHostsPage({ params, searchParams }: Props) {
  const { id: hostIdA } = await params
  const { with: hostIdB = '' } = await searchParams

  return <CompareHostsClient hostIdA={hostIdA} hostIdB={hostIdB} />
}
