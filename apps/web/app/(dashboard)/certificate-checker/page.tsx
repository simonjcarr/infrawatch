import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
import { CertificateCheckerClient } from './certificate-checker-client'

export const metadata: Metadata = {
  title: 'SSL Certificate Checker',
}

export default async function CertificateCheckerPage() {
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  return <CertificateCheckerClient orgId={orgId} />
}
