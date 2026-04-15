import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { getRequiredSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { organisations, softwarePackages, hosts } from '@/lib/db/schema'
import { eq, and, isNull, ilike } from 'drizzle-orm'
import { SoftwareReportPDF } from '@/lib/pdf/software-report'
import { compareVersions } from '@/lib/version-compare'

/**
 * Simple in-memory per-user rate limiter.
 * One export per user per 30 seconds.
 * Note: this is per-process; a multi-instance deployment needs Redis.
 */
const rateLimitMap = new Map<string, number>()
const RATE_LIMIT_MS = 10_000

function checkRateLimit(userId: string): boolean {
  const last = rateLimitMap.get(userId) ?? 0
  const now = Date.now()
  if (now - last < RATE_LIMIT_MS) return false
  rateLimitMap.set(userId, now)
  return true
}

const filterSchema = z.object({
  format: z.enum(['csv', 'pdf']),
  name: z.string().max(100).optional(),
  vm: z.enum(['any', 'exact', 'prefix', 'between']).optional(),
  ve: z.string().max(100).optional(),
  vp: z.string().max(100).optional(),
  vl: z.string().max(100).optional(),
  vh: z.string().max(100).optional(),
  of: z.string().max(20).optional(),
  hostId: z.string().max(50).optional(),
})

/** Escape a CSV cell value. Prefixes formula-injection chars with a literal '. */
function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '')
  if (/^[=+\-@\t\r\n]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function rowToCsv(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(',')
}

export async function GET(req: NextRequest) {
  // Auth
  let session: Awaited<ReturnType<typeof getRequiredSession>>
  try {
    session = await getRequiredSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = session.user.organisationId
  if (!orgId) {
    return NextResponse.json({ error: 'No organisation' }, { status: 403 })
  }

  // Rate limit
  if (!checkRateLimit(session.user.id)) {
    return NextResponse.json(
      { error: 'Rate limited — please wait 30 seconds between exports.' },
      { status: 429 },
    )
  }

  // Parse + validate query params
  const sp = req.nextUrl.searchParams
  const rawParams = {
    format: sp.get('format') ?? undefined,
    name: sp.get('name') ?? undefined,
    vm: sp.get('vm') ?? undefined,
    ve: sp.get('ve') ?? undefined,
    vp: sp.get('vp') ?? undefined,
    vl: sp.get('vl') ?? undefined,
    vh: sp.get('vh') ?? undefined,
    of: sp.get('of') ?? undefined,
    hostId: sp.get('hostId') ?? undefined,
  }

  const parsed = filterSchema.safeParse(rawParams)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const { format, name, vm, ve, vp, vl, vh, of: osFamily } = parsed.data

  // ── Fetch per-host rows (exact name match — same as the UI table) ─────────────
  const whereConditions = and(
    eq(softwarePackages.organisationId, orgId),
    name ? eq(softwarePackages.name, name) : undefined,
    isNull(softwarePackages.removedAt),
    isNull(softwarePackages.deletedAt),
    isNull(hosts.deletedAt),
    osFamily ? ilike(hosts.os, `%${osFamily}%`) : undefined,
  )

  let rows = await db
    .select({
      name: softwarePackages.name,
      version: softwarePackages.version,
      source: softwarePackages.source,
      architecture: softwarePackages.architecture,
      firstSeenAt: softwarePackages.firstSeenAt,
      lastSeenAt: softwarePackages.lastSeenAt,
      hostname: hosts.hostname,
      displayName: hosts.displayName,
      os: hosts.os,
      osVersion: hosts.osVersion,
    })
    .from(softwarePackages)
    .innerJoin(hosts, eq(hosts.id, softwarePackages.hostId))
    .where(whereConditions)
    .orderBy(softwarePackages.name, softwarePackages.version, hosts.hostname)
    .limit(250_001)

  if (rows.length > 250_000) {
    return NextResponse.json(
      { error: 'Result set too large (>250,000 rows). Narrow your filters and try again.' },
      { status: 413 },
    )
  }

  // Apply version filtering server-side (mirrors client-side logic)
  const versionMode = vm ?? 'any'
  if (versionMode !== 'any') {
    if (versionMode === 'exact' && ve) {
      rows = rows.filter((r) => r.version === ve)
    } else if (versionMode === 'prefix' && vp) {
      rows = rows.filter((r) => r.version.startsWith(vp))
    } else if (versionMode === 'between' && vl && vh) {
      rows = rows.filter((r) => {
        const cmpLow = compareVersions(r.version, vl)
        const cmpHigh = compareVersions(r.version, vh)
        return cmpLow >= 0 && cmpHigh <= 0
      })
    }
  }

  const generatedAt = new Date()
  const packageName = name ?? 'All packages'

  // ── CSV ──────────────────────────────────────────────────────────────────────
  if (format === 'csv') {
    const lines: string[] = [
      rowToCsv(['Package', 'Host', 'OS', 'Version', 'Source', 'Architecture', 'First seen', 'Last seen']),
    ]
    for (const row of rows) {
      lines.push(
        rowToCsv([
          row.name,
          row.displayName ?? row.hostname,
          row.osVersion ?? row.os ?? '',
          row.version,
          row.source,
          row.architecture ?? '',
          row.firstSeenAt.toISOString().slice(0, 10),
          row.lastSeenAt.toISOString().slice(0, 10),
        ]),
      )
    }
    const csv = lines.join('\r\n')
    const filename = `software-report-${generatedAt.toISOString().slice(0, 10)}.csv`
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── PDF ──────────────────────────────────────────────────────────────────────
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { name: true },
  })
  const orgName = org?.name ?? 'Infrawatch'

  const pdfElement = createElement(SoftwareReportPDF, {
    orgName,
    packageName,
    versionFilter: vm && vm !== 'any' ? { mode: vm, exact: ve, prefix: vp, low: vl, high: vh } : undefined,
    osFamily,
    rows,
    generatedAt,
  }) as ReactElement<DocumentProps>
  const pdfBuffer = await renderToBuffer(pdfElement)
  const pdfBytes = new Uint8Array(pdfBuffer as unknown as ArrayBuffer)

  const filename = `software-report-${generatedAt.toISOString().slice(0, 10)}.pdf`
  return new NextResponse(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
