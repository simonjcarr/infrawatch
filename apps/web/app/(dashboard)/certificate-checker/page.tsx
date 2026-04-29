import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import { CertificateCheckerClient } from './certificate-checker-client'

export const metadata: Metadata = {
  title: 'SSL Certificate Checker',
}

export default async function CertificateCheckerPage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const orgId = session.user.organisationId!
  return <CertificateCheckerClient orgId={orgId} />
}
