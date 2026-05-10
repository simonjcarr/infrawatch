'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  getCurrentUpdatesForHost as getCurrentUpdatesForHostCore,
  getHostPatchStatus as getHostPatchStatusCore,
  getPatchManagementReport as getPatchManagementReportCore,
  type HostPatchStatusDetails,
  type PatchManagementReport,
  type PatchPackageUpdate,
  type PatchReportHostRow,
  type PatchReportNetworkRow,
} from './patch-status-core'

export type {
  HostPatchStatusDetails,
  PatchManagementReport,
  PatchPackageUpdate,
  PatchReportHostRow,
  PatchReportNetworkRow,
} from './patch-status-core'

export async function getHostPatchStatus(
  hostId: string,
): Promise<HostPatchStatusDetails | null> {
  const session = await getRequiredSession()
  return getHostPatchStatusCore(resolveCurrentActionScope(session), hostId)
}

export async function getCurrentUpdatesForHost(
  hostId: string,
): Promise<PatchPackageUpdate[]> {
  const session = await getRequiredSession()
  return getCurrentUpdatesForHostCore(resolveCurrentActionScope(session), hostId)
}

export async function getPatchManagementReport(): Promise<PatchManagementReport> {
  const session = await getRequiredSession()
  return getPatchManagementReportCore(resolveCurrentActionScope(session))
}
