'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  deleteCertificate as deleteCertificateCore,
  getCertificate as getCertificateCore,
  getCertificateCounts as getCertificateCountsCore,
  getCertificates as getCertificatesCore,
  trackCertificateFromUpload as trackCertificateFromUploadCore,
  trackCertificateFromUrl as trackCertificateFromUrlCore,
  type CertificateCounts,
  type CertificateListFilters,
  type TrackCertificateResult,
} from './certificates-core'

export type {
  CertificateCounts,
  CertificateListFilters,
  TrackCertificateResult,
} from './certificates-core'

export async function getCertificates(
  filters: CertificateListFilters = {},
): Promise<Awaited<ReturnType<typeof getCertificatesCore>>> {
  const session = await getRequiredSession()
  return getCertificatesCore(resolveCurrentActionScope(session), filters)
}

export async function getCertificate(
  certId: string,
): Promise<Awaited<ReturnType<typeof getCertificateCore>>> {
  const session = await getRequiredSession()
  return getCertificateCore(resolveCurrentActionScope(session), certId)
}

export async function getCertificateCounts(): Promise<CertificateCounts> {
  const session = await getRequiredSession()
  return getCertificateCountsCore(resolveCurrentActionScope(session))
}

export async function deleteCertificate(
  certId: string,
): Promise<Awaited<ReturnType<typeof deleteCertificateCore>>> {
  const session = await getRequiredSession()
  return deleteCertificateCore(resolveCurrentActionScope(session), certId)
}

export async function trackCertificateFromUrl(
  input: Parameters<typeof trackCertificateFromUrlCore>[1],
): Promise<TrackCertificateResult> {
  const session = await getRequiredSession()
  return trackCertificateFromUrlCore(resolveCurrentActionScope(session), input)
}

export async function trackCertificateFromUpload(
  input: Parameters<typeof trackCertificateFromUploadCore>[1],
): Promise<TrackCertificateResult> {
  const session = await getRequiredSession()
  return trackCertificateFromUploadCore(resolveCurrentActionScope(session), input)
}
