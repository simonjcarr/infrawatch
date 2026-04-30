import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Database } from '../../db/index.ts'
import { hostVulnerabilityFindings, hosts, softwarePackages, vulnerabilityCves } from '../../db/schema/index.ts'
import type { VulnerabilityFindingConfidence, VulnerabilityFindingStatus, VulnerabilitySeverity } from '../../db/schema/vulnerabilities.ts'

export interface CtCveFindingBatchResult {
  accepted: boolean
  batchId: string
  findingsAccepted: number
  findingsRejected: number
  findingsSkipped: number
  rejections?: CtCveFindingRejection[]
}

export interface CtCveFindingRejection {
  findingId: string
  code:
    | 'invalid_payload'
    | 'unknown_host'
    | 'deleted_host'
    | 'unknown_software_package'
    | 'inactive_software_package'
    | 'software_package_host_mismatch'
    | 'resolved_finding_not_imported'
  message: string
}

interface HostRecord {
  id: string
  organisationId: string
  deletedAt: Date | null
}

interface SoftwarePackageRecord {
  id: string
  organisationId: string
  hostId: string
  removedAt: Date | null
  deletedAt: Date | null
}

interface ExistingFindingRecord {
  lastSeenAt: Date
}

type FindingKey = [hostId: string, softwarePackageId: string, cveId: string]

export interface CtCveFindingRepository {
  transaction<T>(run: (repository: CtCveFindingRepository) => Promise<T>): Promise<T>
  getHosts(orgId: string, hostIds: string[]): Promise<Map<string, HostRecord>>
  getSoftwarePackages(orgId: string, packageIds: string[]): Promise<Map<string, SoftwarePackageRecord>>
  getExistingFindings(orgId: string, keys: FindingKey[]): Promise<Map<string, ExistingFindingRecord>>
  upsertCve(cve: NormalizedCtCveFinding['cve'] & {
    cveId: string
    severity: VulnerabilitySeverity
    cvssScore: number | null
    knownExploited: boolean
    source: string
    metadata: Record<string, unknown>
  }): Promise<void>
  upsertFinding(finding: {
    organisationId: string
    hostId: string
    softwarePackageId: string
    cveId: string
    status: VulnerabilityFindingStatus
    packageName: string
    installedVersion: string
    fixedVersion: string | null
    source: string
    severity: VulnerabilitySeverity
    cvssScore: number | null
    knownExploited: boolean
    confidence: VulnerabilityFindingConfidence
    matchReason: string | null
    firstSeenAt: Date
    lastSeenAt: Date
    resolvedAt: Date | null
    metadata: Record<string, unknown>
  }): Promise<void>
}

const CONTRACT_VERSION = '2026-04-30'
const MAX_FINDINGS = 5_000

const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'none', 'unknown'])
const statusSchema = z.enum(['open', 'resolved'])
const confidenceSchema = z.enum(['confirmed', 'probable', 'unsupported'])
const dateSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value))

const cveSchema = z.object({
  title: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  publishedAt: dateSchema.nullable().optional(),
  modifiedAt: dateSchema.nullable().optional(),
  rejected: z.boolean().optional(),
  kevDueDate: dateSchema.nullable().optional(),
  kevVendorProject: z.string().trim().max(300).nullable().optional(),
  kevProduct: z.string().trim().max(300).nullable().optional(),
  kevRequiredAction: z.string().trim().max(2_000).nullable().optional(),
}).strip()

const findingSchema = z.object({
  findingId: z.string().trim().min(1).max(200),
  hostId: z.string().trim().min(1).max(200),
  softwarePackageId: z.string().trim().min(1).max(200),
  cveId: z.string().trim().regex(/^CVE-\d{4}-\d{4,}$/i).transform((value) => value.toUpperCase()),
  status: statusSchema,
  packageName: z.string().trim().min(1).max(300),
  installedVersion: z.string().trim().min(1).max(500),
  fixedVersion: z.string().trim().max(500).nullable().optional(),
  source: z.string().trim().min(1).max(100),
  severity: severitySchema.default('unknown'),
  cvssScore: z.number().min(0).max(10).nullable().optional(),
  knownExploited: z.boolean().default(false),
  confidence: confidenceSchema.default('confirmed'),
  matchReason: z.string().trim().max(2_000).nullable().optional(),
  firstSeenAt: dateSchema,
  lastSeenAt: dateSchema,
  resolvedAt: dateSchema.nullable().optional(),
  cve: cveSchema.optional(),
  references: z.array(z.string().url()).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strip()

const batchSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  orgId: z.string().trim().min(1).max(200),
  batchId: z.string().trim().min(1).max(200),
  generatedAt: dateSchema,
  findings: z.array(findingSchema).max(MAX_FINDINGS),
}).strip()

type NormalizedCtCveFinding = z.infer<typeof findingSchema>
type NormalizedCtCveFindingBatch = z.infer<typeof batchSchema>

export class CtCveFindingBatchValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('Invalid CT-CVE finding batch payload.')
    this.name = 'CtCveFindingBatchValidationError'
    this.issues = issues
  }
}

function keyFor(input: FindingKey): string {
  return input.join('\0')
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

export async function ingestCtCveFindingBatch(
  input: unknown,
  options: { repository?: CtCveFindingRepository } = {},
): Promise<CtCveFindingBatchResult> {
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) {
    throw new CtCveFindingBatchValidationError(parsed.error.issues.map((issue) => issue.message))
  }

  const batch = parsed.data
  const repository = options.repository ?? await getDefaultRepository()

  return repository.transaction(async (tx) => ingestValidatedBatch(batch, tx))
}

async function ingestValidatedBatch(
  batch: NormalizedCtCveFindingBatch,
  repository: CtCveFindingRepository,
): Promise<CtCveFindingBatchResult> {
  const hostIds = unique(batch.findings.map((finding) => finding.hostId))
  const packageIds = unique(batch.findings.map((finding) => finding.softwarePackageId))
  const findingKeys: FindingKey[] = batch.findings.map((finding) => [
    finding.hostId,
    finding.softwarePackageId,
    finding.cveId,
  ])

  const [hostMap, packageMap, existingMap] = await Promise.all([
    repository.getHosts(batch.orgId, hostIds),
    repository.getSoftwarePackages(batch.orgId, packageIds),
    repository.getExistingFindings(batch.orgId, findingKeys),
  ])

  const rejections: CtCveFindingRejection[] = []
  let findingsAccepted = 0
  let findingsSkipped = 0

  for (const finding of batch.findings) {
    const existing = existingMap.get(keyFor([finding.hostId, finding.softwarePackageId, finding.cveId]))
    const rejection = validateFindingReferences(finding, hostMap, packageMap, existing)
    if (rejection) {
      rejections.push(rejection)
      continue
    }

    if (existing && existing.lastSeenAt.getTime() > finding.lastSeenAt.getTime()) {
      findingsSkipped += 1
      continue
    }

    await repository.upsertCve({
      cveId: finding.cveId,
      title: finding.cve?.title ?? null,
      description: finding.cve?.description ?? null,
      severity: finding.severity,
      cvssScore: finding.cvssScore ?? null,
      publishedAt: finding.cve?.publishedAt ?? null,
      modifiedAt: finding.cve?.modifiedAt ?? null,
      rejected: finding.cve?.rejected ?? false,
      knownExploited: finding.knownExploited,
      kevDueDate: finding.cve?.kevDueDate ?? null,
      kevVendorProject: finding.cve?.kevVendorProject ?? null,
      kevProduct: finding.cve?.kevProduct ?? null,
      kevRequiredAction: finding.cve?.kevRequiredAction ?? null,
      source: finding.source,
      metadata: {
        references: finding.references ?? [],
        ctCveBatchId: batch.batchId,
      },
    })

    await repository.upsertFinding({
      organisationId: batch.orgId,
      hostId: finding.hostId,
      softwarePackageId: finding.softwarePackageId,
      cveId: finding.cveId,
      status: finding.status,
      packageName: finding.packageName,
      installedVersion: finding.installedVersion,
      fixedVersion: finding.fixedVersion ?? null,
      source: finding.source,
      severity: finding.severity,
      cvssScore: finding.cvssScore ?? null,
      knownExploited: finding.knownExploited,
      confidence: finding.confidence,
      matchReason: finding.matchReason ?? null,
      firstSeenAt: finding.firstSeenAt,
      lastSeenAt: finding.lastSeenAt,
      resolvedAt: finding.status === 'resolved' ? finding.resolvedAt ?? finding.lastSeenAt : null,
      metadata: {
        ...(finding.metadata ?? {}),
        references: finding.references ?? [],
        ctCveFindingId: finding.findingId,
        ctCveBatchId: batch.batchId,
        ctCveGeneratedAt: batch.generatedAt.toISOString(),
      },
    })
    findingsAccepted += 1
  }

  return {
    accepted: rejections.length === 0,
    batchId: batch.batchId,
    findingsAccepted,
    findingsRejected: rejections.length,
    findingsSkipped,
    ...(rejections.length > 0 ? { rejections } : {}),
  }
}

function validateFindingReferences(
  finding: NormalizedCtCveFinding,
  hostMap: Map<string, HostRecord>,
  packageMap: Map<string, SoftwarePackageRecord>,
  existing: ExistingFindingRecord | undefined,
): CtCveFindingRejection | null {
  const host = hostMap.get(finding.hostId)
  const softwarePackage = packageMap.get(finding.softwarePackageId)

  if (!host) {
    return finding.status === 'resolved' && existing
      ? null
      : { findingId: finding.findingId, code: 'unknown_host', message: 'Finding references an unknown host.' }
  }
  if (host.deletedAt) {
    return finding.status === 'resolved' && existing
      ? null
      : { findingId: finding.findingId, code: 'deleted_host', message: 'Finding references a deleted host.' }
  }

  if (!softwarePackage) {
    return finding.status === 'resolved' && existing
      ? null
      : { findingId: finding.findingId, code: 'unknown_software_package', message: 'Finding references an unknown software package.' }
  }
  if (softwarePackage.hostId !== finding.hostId) {
    return { findingId: finding.findingId, code: 'software_package_host_mismatch', message: 'Finding host and software package do not match.' }
  }
  if (finding.status === 'open' && (softwarePackage.removedAt || softwarePackage.deletedAt)) {
    return { findingId: finding.findingId, code: 'inactive_software_package', message: 'Open finding references an inactive software package.' }
  }
  if (finding.status === 'resolved' && !existing) {
    return { findingId: finding.findingId, code: 'resolved_finding_not_imported', message: 'Resolved tombstone does not match an imported finding.' }
  }

  return null
}

async function getDefaultRepository() {
  const { db: database } = await import('../../db/index.ts')
  return createDrizzleCtCveFindingRepository(database)
}

function createDrizzleCtCveFindingRepository(database: Database): CtCveFindingRepository {
  return {
    async transaction(run) {
      return database.transaction(async (tx) => run(createDrizzleCtCveFindingRepository(tx as unknown as Database)))
    },
    async getHosts(orgId, hostIds) {
      if (hostIds.length === 0) return new Map()
      const rows = await database
        .select({
          id: hosts.id,
          organisationId: hosts.organisationId,
          deletedAt: hosts.deletedAt,
        })
        .from(hosts)
        .where(and(eq(hosts.organisationId, orgId), inArray(hosts.id, hostIds)))
      return new Map(rows.map((row) => [row.id, row]))
    },
    async getSoftwarePackages(orgId, packageIds) {
      if (packageIds.length === 0) return new Map()
      const rows = await database
        .select({
          id: softwarePackages.id,
          organisationId: softwarePackages.organisationId,
          hostId: softwarePackages.hostId,
          removedAt: softwarePackages.removedAt,
          deletedAt: softwarePackages.deletedAt,
        })
        .from(softwarePackages)
        .where(and(eq(softwarePackages.organisationId, orgId), inArray(softwarePackages.id, packageIds)))
      return new Map(rows.map((row) => [row.id, row]))
    },
    async getExistingFindings(orgId, keys) {
      if (keys.length === 0) return new Map()
      const hostIds = unique(keys.map(([hostId]) => hostId))
      const packageIds = unique(keys.map(([, packageId]) => packageId))
      const cveIds = unique(keys.map(([, , cveId]) => cveId))
      const rows = await database
        .select({
          hostId: hostVulnerabilityFindings.hostId,
          softwarePackageId: hostVulnerabilityFindings.softwarePackageId,
          cveId: hostVulnerabilityFindings.cveId,
          lastSeenAt: hostVulnerabilityFindings.lastSeenAt,
        })
        .from(hostVulnerabilityFindings)
        .where(and(
          eq(hostVulnerabilityFindings.organisationId, orgId),
          inArray(hostVulnerabilityFindings.hostId, hostIds),
          inArray(hostVulnerabilityFindings.softwarePackageId, packageIds),
          inArray(hostVulnerabilityFindings.cveId, cveIds),
        ))
      return new Map(rows.map((row) => [keyFor([row.hostId, row.softwarePackageId, row.cveId]), { lastSeenAt: row.lastSeenAt }]))
    },
    async upsertCve(cve) {
      await database.insert(vulnerabilityCves).values({
        cveId: cve.cveId,
        title: cve.title,
        description: cve.description,
        severity: cve.severity,
        cvssScore: cve.cvssScore,
        publishedAt: cve.publishedAt,
        modifiedAt: cve.modifiedAt,
        rejected: cve.rejected,
        knownExploited: cve.knownExploited,
        kevDueDate: cve.kevDueDate,
        kevVendorProject: cve.kevVendorProject,
        kevProduct: cve.kevProduct,
        kevRequiredAction: cve.kevRequiredAction,
        source: cve.source,
        metadata: cve.metadata,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: vulnerabilityCves.cveId,
        set: {
          title: cve.title,
          description: cve.description,
          severity: cve.severity,
          cvssScore: cve.cvssScore,
          publishedAt: cve.publishedAt,
          modifiedAt: cve.modifiedAt,
          rejected: cve.rejected,
          knownExploited: cve.knownExploited,
          kevDueDate: cve.kevDueDate,
          kevVendorProject: cve.kevVendorProject,
          kevProduct: cve.kevProduct,
          kevRequiredAction: cve.kevRequiredAction,
          source: cve.source,
          metadata: cve.metadata,
          updatedAt: new Date(),
        },
      })
    },
    async upsertFinding(finding) {
      await database.insert(hostVulnerabilityFindings).values({
        ...finding,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [
          hostVulnerabilityFindings.organisationId,
          hostVulnerabilityFindings.hostId,
          hostVulnerabilityFindings.softwarePackageId,
          hostVulnerabilityFindings.cveId,
        ],
        set: {
          status: finding.status,
          packageName: finding.packageName,
          installedVersion: finding.installedVersion,
          fixedVersion: finding.fixedVersion,
          source: finding.source,
          severity: finding.severity,
          cvssScore: finding.cvssScore,
          knownExploited: finding.knownExploited,
          confidence: finding.confidence,
          matchReason: finding.matchReason,
          firstSeenAt: sql`LEAST(${hostVulnerabilityFindings.firstSeenAt}, ${finding.firstSeenAt})`,
          lastSeenAt: finding.lastSeenAt,
          resolvedAt: finding.resolvedAt,
          metadata: finding.metadata,
          updatedAt: new Date(),
        },
      })
    },
  }
}
