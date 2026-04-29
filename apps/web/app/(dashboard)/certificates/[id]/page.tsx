import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getCertificate } from '@/lib/actions/certificates'
import { CertificateDetailClient } from './certificate-detail-client'

export const metadata: Metadata = {
  title: 'Certificate Detail',
}

export default async function CertificateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const { id } = await params

  const result = await getCertificate(orgId, id)
  if (!result) notFound()

  return (
    <CertificateDetailClient
      orgId={orgId}
      initialCertificate={result.certificate}
      initialEvents={result.events}
    />
  )
}
