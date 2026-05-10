import type { Metadata } from 'next'
import { getCertificates, getCertificateCounts } from '@/lib/actions/certificates'
import { CertificatesClient } from './certificates-client'

export const metadata: Metadata = {
  title: 'Certificates',
}

export default async function CertificatesPage() {
  const [initialCertificates, initialCounts] = await Promise.all([
    getCertificates({ sortBy: 'not_after', sortDir: 'asc', limit: 100 }),
    getCertificateCounts(),
  ])

  return (
    <CertificatesClient
      initialCertificates={initialCertificates}
      initialCounts={initialCounts}
    />
  )
}
