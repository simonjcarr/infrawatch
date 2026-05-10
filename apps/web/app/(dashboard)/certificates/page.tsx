import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { getCertificates, getCertificateCounts } from '@/lib/actions/certificates'
import { EMPTY_CERTIFICATE_COUNTS } from '@/lib/standalone-empty-state'
import { CertificatesClient } from './certificates-client'

export const metadata: Metadata = {
  title: 'Certificates',
}

export default async function CertificatesPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId

  if (!orgId) {
    return (
      <CertificatesClient
        orgId=""
        initialCertificates={[]}
        initialCounts={EMPTY_CERTIFICATE_COUNTS}
      />
    )
  }

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
