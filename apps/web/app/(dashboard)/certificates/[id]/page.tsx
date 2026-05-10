import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
  const { id } = await params

  const result = await getCertificate(id)
  if (!result) notFound()

  return (
    <CertificateDetailClient
      initialCertificate={result.certificate}
      initialEvents={result.events}
    />
  )
}
