import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { supportAttachments, supportTickets } from '@/lib/db/schema'
import { getOptionalSession } from '@/lib/auth/session'
import { serveAttachment } from '@/lib/support/storage'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const session = await getOptionalSession()
  if (!session) {
    return new NextResponse('Unauthorised', { status: 401 })
  }
  const { user } = session

  const { attachmentId } = await ctx.params

  const attachment = await db.query.supportAttachments.findFirst({
    where: eq(supportAttachments.id, attachmentId),
  })
  if (!attachment) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Super-admins can access any attachment.
  if (user.role !== 'super_admin') {
    if (!attachment.ticketId) {
      // Orphaned — only the uploader may access.
      if (attachment.uploadedByUserId !== user.id) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    } else {
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, attachment.ticketId),
      })
      if (!ticket || ticket.organisationId !== user.organisationId) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
  }

  const result = await serveAttachment({
    storagePath: attachment.storagePath,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    filename: attachment.filename,
  })

  if (result.kind === 'not_found') {
    return new NextResponse('File not found on server', { status: 404 })
  }

  if (result.kind === 'redirect') {
    return NextResponse.redirect(result.url, { status: 302 })
  }

  const isInline =
    attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf'
  const disposition = isInline
    ? `inline; filename="${attachment.filename}"`
    : `attachment; filename="${attachment.filename}"`

  return new Response(result.stream, {
    status: 200,
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Length': String(result.contentLength),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
