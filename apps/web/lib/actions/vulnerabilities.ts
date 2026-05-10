'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  getHostVulnerabilities as getHostVulnerabilitiesCore,
  getHostVulnerabilityAssessment as getHostVulnerabilityAssessmentCore,
  getVulnerabilityReport as getVulnerabilityReportCore,
  type HostVulnerabilityAssessment,
  type VulnerabilityFindingConfidence,
  type VulnerabilityReport,
  type VulnerabilityReportFilters,
  type VulnerabilitySeverity,
} from './vulnerabilities-core'

export type {
  HostVulnerabilityAssessment,
  VulnerabilityFindingConfidence,
  VulnerabilityReport,
  VulnerabilityReportFilters,
  VulnerabilitySeverity,
} from './vulnerabilities-core'

export async function getVulnerabilityReport(
  filters: VulnerabilityReportFilters = {},
): Promise<VulnerabilityReport> {
  const session = await getRequiredSession()
  return getVulnerabilityReportCore(resolveCurrentActionScope(session), filters)
}

export async function getHostVulnerabilities(
  hostId: string,
): Promise<Awaited<ReturnType<typeof getHostVulnerabilitiesCore>>> {
  const session = await getRequiredSession()
  return getHostVulnerabilitiesCore(resolveCurrentActionScope(session), hostId)
}

export async function getHostVulnerabilityAssessment(
  hostId: string,
): Promise<HostVulnerabilityAssessment> {
  const session = await getRequiredSession()
  return getHostVulnerabilityAssessmentCore(resolveCurrentActionScope(session), hostId)
}
