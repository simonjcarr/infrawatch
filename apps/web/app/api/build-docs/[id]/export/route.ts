import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequiredSession } from '@/lib/auth/session'
import { getBuildDocRenderModel } from '@/lib/actions/build-docs'
import { renderBuildDocDocx, renderBuildDocPdf } from '@/lib/build-docs/export'

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX = 3

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(userId) ?? []
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) return false
  recent.push(now)
  rateLimitMap.set(userId, recent)
  return true
}

function safeFilename(title: string, extension: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'build-doc'
  return `${base}.${extension}`
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session: Awaited<ReturnType<typeof getRequiredSession>>
  try {
    session = await getRequiredSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgId = session.user.organisationId
  if (!orgId) return NextResponse.json({ error: 'No organisation' }, { status: 403 })
  if (!checkRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'Too many exports. Please wait a moment and try again.' }, { status: 429 })
  }

  const parsed = z.object({ format: z.enum(['pdf', 'docx']) }).safeParse({
    format: request.nextUrl.searchParams.get('format'),
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid export format' }, { status: 400 })

  const { id } = await params
  const model = await getBuildDocRenderModel(orgId, id)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (parsed.data.format === 'pdf') {
    const bytes = await renderBuildDocPdf(model)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(model.doc.title, 'pdf')}"`,
      },
    })
  }

  const bytes = await renderBuildDocDocx(model)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeFilename(model.doc.title, 'docx')}"`,
    },
  })
}
