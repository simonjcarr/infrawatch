import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getCertificates, getCertificateCounts } from '@/lib/actions/certificates'
import { CertificatesClient } from './certificates-client'

export const metadata: Metadata = {
  title: 'Certificates',
}

export default async function CertificatesPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!

  const [initialCertificates, initialCounts] = await Promise.all([
    getCertificates(orgId, { sortBy: 'not_after', sortDir: 'asc', limit: 100 }),
    getCertificateCounts(orgId),
  ])

  return (
    <CertificatesClient
      orgId={orgId}
      initialCertificates={initialCertificates}
      initialCounts={initialCounts}
    />
  )
}
