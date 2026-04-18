import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { getCertificate } from '@/lib/actions/certificates'
import { getEffectiveLicence } from '@/lib/actions/licence-guard'
import { hasFeature } from '@/lib/features'
import { LockedFeature } from '@/components/shared/locked-feature'
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

  const licence = await getEffectiveLicence(orgId)
  if (!hasFeature(licence.tier, 'certExpiryTracker')) {
    return <LockedFeature feature="certExpiryTracker" tier={licence.tier} />
  }

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
