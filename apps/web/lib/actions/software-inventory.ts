'use server'

import { getRequiredSession } from '@/lib/auth/session'
import type { SavedSoftwareReport, SoftwareInventorySettings } from '@/lib/db/schema'
import {
  compareHosts as compareHostsCore,
  deleteSavedReport as deleteSavedReportCore,
  getHostSoftwareInventory as getHostSoftwareInventoryCore,
  getNewPackages as getNewPackagesCore,
  getPackageDetails as getPackageDetailsCore,
  getPackageDrift as getPackageDriftCore,
  getPackageVersions as getPackageVersionsCore,
  getSoftwareInventorySettings as getSoftwareInventorySettingsCore,
  getSoftwareReport as getSoftwareReportCore,
  listSavedReports as listSavedReportsCore,
  saveSoftwareReport as saveSoftwareReportCore,
  searchPackageNames as searchPackageNamesCore,
  triggerSoftwareScan as triggerSoftwareScanCore,
  updateSoftwareInventorySettings as updateSoftwareInventorySettingsCore,
  type DriftRow,
  type HostCompareResult,
  type HostSoftwareInventory,
  type NewPackageRow,
  type PackageDetailsResult,
  type PackageNameSuggestion,
  type SoftwareReportFilters,
  type SoftwareReportResult,
} from './software-inventory-core'
import { resolveCurrentActionScope } from './action-scope'

export type {
  DriftRow,
  HostCompareResult,
  HostSoftwareInventory,
  NewPackageRow,
  PackageDetailsResult,
  PackageNameSuggestion,
  SoftwareReportFilters,
  SoftwareReportResult,
  VersionMode,
  PackageHostInfo,
  PackageVersionGroup,
} from './software-inventory-core'

export async function getSoftwareInventorySettings(
  ...args: [] | [string]
): Promise<SoftwareInventorySettings> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return getSoftwareInventorySettingsCore(currentScope)
}

export async function updateSoftwareInventorySettings(
  ...args: [SoftwareInventorySettings] | [string, SoftwareInventorySettings]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope =
    args.length === 2 ? args[0] : resolveCurrentActionScope(session)
  const settings = args.length === 2 ? args[1] : args[0]
  return updateSoftwareInventorySettingsCore(currentScope, settings)
}

export async function triggerSoftwareScan(
  ...args: [string] | [string, string]
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return triggerSoftwareScanCore(currentScope, hostId)
}

export async function getHostSoftwareInventory(
  ...args: [string, boolean?] | [string, string, boolean?]
): Promise<HostSoftwareInventory> {
  const session = await getRequiredSession()
  const currentScope =
    args.length >= 2 && typeof args[1] === 'string'
      ? args[0]
      : resolveCurrentActionScope(session)
  const hostId =
    args.length >= 2 && typeof args[1] === 'string'
      ? args[1]
      : args[0]
  const includeRemoved =
    args.length >= 2 && typeof args[1] === 'string'
      ? args[2]
      : args[1]
  return getHostSoftwareInventoryCore(currentScope, hostId, includeRemoved as boolean | undefined)
}

export async function searchPackageNames(
  ...args: [string] | [string, string]
): Promise<PackageNameSuggestion[]> {
  const session = await getRequiredSession()
  const [currentScope, query] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return searchPackageNamesCore(currentScope, query)
}

export async function getSoftwareReport(
  ...args: [SoftwareReportFilters] | [string, SoftwareReportFilters]
): Promise<SoftwareReportResult> {
  const session = await getRequiredSession()
  const currentScope =
    args.length === 2 ? args[0] : resolveCurrentActionScope(session)
  const filters = args.length === 2 ? args[1] : args[0]
  return getSoftwareReportCore(currentScope, filters)
}

export async function getNewPackages(
  ...args: [number?] | [string, number?]
): Promise<NewPackageRow[]> {
  const session = await getRequiredSession()
  const currentScope =
    args.length === 2 ? args[0] : resolveCurrentActionScope(session)
  const windowDays = args.length === 2 ? args[1] : args[0]
  return getNewPackagesCore(currentScope, windowDays as 7 | 30 | undefined)
}

export async function getPackageDrift(
  ...args: [] | [string]
): Promise<DriftRow[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return getPackageDriftCore(currentScope)
}

export async function getPackageDetails(
  ...args: [string, string?] | [string, string, string?]
): Promise<PackageDetailsResult> {
  const session = await getRequiredSession()
  const currentScope =
    args.length >= 2 && typeof args[1] === 'string' && args.length === 3
      ? args[0]
      : resolveCurrentActionScope(session)
  const packageName =
    args.length >= 2 && typeof args[1] === 'string' && args.length === 3
      ? args[1]
      : args[0]
  const osFamily =
    args.length >= 2 && typeof args[1] === 'string' && args.length === 3
      ? args[2]
      : args[1]
  return getPackageDetailsCore(currentScope, packageName, osFamily)
}

export async function getPackageVersions(
  ...args: [string] | [string, string]
): Promise<string[]> {
  const session = await getRequiredSession()
  const [currentScope, packageName] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getPackageVersionsCore(currentScope, packageName)
}

export async function compareHosts(
  ...args: [string, string] | [string, string, string]
): Promise<HostCompareResult> {
  const session = await getRequiredSession()
  const currentScope =
    args.length === 3 ? args[0] : resolveCurrentActionScope(session)
  const hostIdA = args.length === 3 ? args[1] : args[0]
  const hostIdB = args.length === 3 ? args[2] : args[1]
  return compareHostsCore(currentScope, hostIdA, hostIdB)
}

export async function listSavedReports(
  ...args: [] | [string]
): Promise<SavedSoftwareReport[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listSavedReportsCore(currentScope)
}

export async function saveSoftwareReport(
  ...args: [string, SoftwareReportFilters] | [string, string, SoftwareReportFilters]
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope =
    args.length === 3 ? args[0] : resolveCurrentActionScope(session)
  const name = args.length === 3 ? args[1] : args[0]
  const filters = args.length === 3 ? args[2] : args[1]
  return saveSoftwareReportCore(currentScope, name, filters)
}

export async function deleteSavedReport(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, reportId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteSavedReportCore(currentScope, reportId)
}
