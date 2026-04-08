'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { checks, checkResults } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import type { Check, CheckConfig, CheckType, CheckResultRow } from '@/lib/db/schema'

export type CheckWithHistory = Check & {
  latestResult: Pick<CheckResultRow, 'status' | 'ranAt' | 'output'> | null
  results: CheckResultRow[]
}

const portConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})

const processConfigSchema = z.object({
  process_name: z.string().min(1),
})

const httpConfigSchema = z.object({
  url: z.string().url(),
  expected_status: z.number().int().min(100).max(599).default(200),
})

const certificateConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  serverName: z.string().optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
})

const createCheckSchema = z.object({
  hostId: z.string().min(1),
  name: z.string().min(1).max(100),
  checkType: z.enum(['port', 'process', 'http', 'certificate']),
  config: z.union([portConfigSchema, processConfigSchema, httpConfigSchema, certificateConfigSchema]),
  intervalSeconds: z.number().int().min(10).max(3600).default(60),
})

const updateCheckSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.union([portConfigSchema, processConfigSchema, httpConfigSchema, certificateConfigSchema]).optional(),
  intervalSeconds: z.number().int().min(10).max(3600).optional(),
})

export async function getChecksWithHistory(orgId: string, hostId: string): Promise<CheckWithHistory[]> {
  const rows = await db.query.checks.findMany({
    where: and(
      eq(checks.organisationId, orgId),
      eq(checks.hostId, hostId),
      isNull(checks.deletedAt),
    ),
    orderBy: checks.createdAt,
  })

  return Promise.all(
    rows.map(async (check) => {
      const results = await db.query.checkResults.findMany({
        where: eq(checkResults.checkId, check.id),
        orderBy: desc(checkResults.ranAt),
        limit: 100,
      })
      return { ...check, results, latestResult: results[0] ?? null }
    }),
  )
}

export async function createCheck(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createCheckSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const [row] = await db
      .insert(checks)
      .values({
        organisationId: orgId,
        hostId: data.hostId,
        name: data.name,
        checkType: data.checkType as CheckType,
        config: data.config as CheckConfig,
        intervalSeconds: data.intervalSeconds,
      })
      .returning({ id: checks.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch {
    return { error: 'Failed to create check' }
  }
}

export async function updateCheck(
  orgId: string,
  checkId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateCheckSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  const existing = await db.query.checks.findFirst({
    where: and(
      eq(checks.id, checkId),
      eq(checks.organisationId, orgId),
      isNull(checks.deletedAt),
    ),
  })
  if (!existing) return { error: 'Check not found' }

  await db
    .update(checks)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.config !== undefined && { config: data.config as CheckConfig }),
      ...(data.intervalSeconds !== undefined && { intervalSeconds: data.intervalSeconds }),
      updatedAt: new Date(),
    })
    .where(and(eq(checks.id, checkId), eq(checks.organisationId, orgId)))

  return { success: true }
}

export async function deleteCheckHistory(
  orgId: string,
  checkId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.checks.findFirst({
    where: and(
      eq(checks.id, checkId),
      eq(checks.organisationId, orgId),
      isNull(checks.deletedAt),
    ),
  })
  if (!existing) return { error: 'Check not found' }

  await db.delete(checkResults).where(eq(checkResults.checkId, checkId))

  return { success: true }
}

export async function deleteCheck(
  orgId: string,
  checkId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.checks.findFirst({
    where: and(
      eq(checks.id, checkId),
      eq(checks.organisationId, orgId),
      isNull(checks.deletedAt),
    ),
  })
  if (!existing) return { error: 'Check not found' }

  await db
    .update(checks)
    .set({ deletedAt: new Date() })
    .where(and(eq(checks.id, checkId), eq(checks.organisationId, orgId)))

  return { success: true }
}

