import type { Metadata } from 'next'
import { CertificateCheckerClient } from './certificate-checker-client'

export const metadata: Metadata = {
  title: 'SSL Certificate Checker',
}

export default function CertificateCheckerPage() {
  return <CertificateCheckerClient />
}
