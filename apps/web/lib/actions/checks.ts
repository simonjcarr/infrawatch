'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { checks, checkResults } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import type { Check, CheckResultRow, CheckConfig, CheckType } from '@/lib/db/schema'

export type { Check, CheckResultRow }

export type CheckWithLatestResult = Check & {
  latestResult: Pick<CheckResultRow, 'status' | 'ranAt' | 'output'> | null
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

const createCheckSchema = z.object({
  hostId: z.string().min(1),
  name: z.string().min(1).max(100),
  checkType: z.enum(['port', 'process', 'http']),
  config: z.union([portConfigSchema, processConfigSchema, httpConfigSchema]),
  intervalSeconds: z.number().int().min(10).max(3600).default(60),
})

const updateCheckSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.union([portConfigSchema, processConfigSchema, httpConfigSchema]).optional(),
  intervalSeconds: z.number().int().min(10).max(3600).optional(),
})

export async function getChecks(orgId: string, hostId: string): Promise<CheckWithLatestResult[]> {
  const rows = await db.query.checks.findMany({
    where: and(
      eq(checks.organisationId, orgId),
      eq(checks.hostId, hostId),
      isNull(checks.deletedAt),
    ),
    orderBy: checks.createdAt,
  })

  // Fetch latest result for each check
  const withResults: CheckWithLatestResult[] = await Promise.all(
    rows.map(async (check) => {
      const latest = await db.query.checkResults.findFirst({
        where: eq(checkResults.checkId, check.id),
        orderBy: desc(checkResults.ranAt),
        columns: { status: true, ranAt: true, output: true },
      })
      return { ...check, latestResult: latest ?? null }
    }),
  )

  return withResults
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

export async function getCheckResults(
  orgId: string,
  checkId: string,
  limit = 20,
): Promise<CheckResultRow[]> {
  // Verify the check belongs to this org
  const check = await db.query.checks.findFirst({
    where: and(eq(checks.id, checkId), eq(checks.organisationId, orgId)),
  })
  if (!check) return []

  return db.query.checkResults.findMany({
    where: eq(checkResults.checkId, checkId),
    orderBy: desc(checkResults.ranAt),
    limit,
  })
}
