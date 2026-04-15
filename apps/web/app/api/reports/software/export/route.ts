import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { getRequiredSession } from '@/lib/auth/session'
import { getSoftwareReport } from '@/lib/actions/software-inventory'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils'
import { SoftwareReportPDF } from '@/lib/pdf/software-report'
import type { SoftwareReportFilters, VersionMode } from '@/lib/actions/software-inventory'

/**
 * Simple in-memory per-user rate limiter.
 * One export per user per 30 seconds.
 * Note: this is per-process; a multi-instance deployment needs Redis.
 */
const rateLimitMap = new Map<string, number>()
const RATE_LIMIT_MS = 30_000

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
  hostId: z.string().max(50).optional(), // single-host CSV from the inventory tab
})

/** Escape a CSV cell value. Prefixes formula-injection chars with a literal '. */
function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '')
  // Guard against CSV injection
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

  const { format, name, vm, ve, vp, vl, vh, of: osFamily, hostId } = parsed.data

  const filters: SoftwareReportFilters = {
    name: name || undefined,
    versionMode: (vm ?? 'any') as VersionMode,
    versionExact: ve || undefined,
    versionPrefix: vp || undefined,
    versionLow: vl || undefined,
    versionHigh: vh || undefined,
    osFamily: osFamily || undefined,
    page: 1,
    pageSize: 250_000, // hard cap enforced below
  }

  // Run report
  const report = await getSoftwareReport(orgId, filters)

  // Enforce row cap
  if (report.total > 250_000) {
    return NextResponse.json(
      {
        error: `Result set too large (${report.total.toLocaleString()} rows). Narrow your filters and try again.`,
      },
      { status: 413 },
    )
  }

  const generatedAt = new Date()

  // ── CSV ──────────────────────────────────────────────────────────────────────
  if (format === 'csv') {
    const lines: string[] = [
      rowToCsv(['Package', 'Version', 'Hosts', 'Sources', 'Host names']),
    ]
    for (const row of report.rows) {
      lines.push(
        rowToCsv([row.name, row.version, row.hostCount, row.sources.join('; '), row.hostNames.join('; ')]),
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
    filters,
    rows: report.rows,
    total: report.total,
    uniquePackages: report.uniquePackages,
    hostsWithData: report.hostsWithData,
    generatedAt,
  }) as ReactElement<DocumentProps>
  const pdfBuffer = await renderToBuffer(pdfElement)
  // renderToBuffer returns a Node.js Buffer; NextResponse accepts Uint8Array.
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
