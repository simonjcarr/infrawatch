import { NextResponse, type NextRequest } from 'next/server'
import path from 'node:path'
import { db } from '@/lib/db'
import { supportAttachments, supportTickets, ATTACHMENT_ALLOWED_MIME_TYPES } from '@/lib/db/schema'
import { getOptionalSession } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { uploadAttachment } from '@/lib/support/storage'
import { and, eq } from 'drizzle-orm'

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getOptionalSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { user } = session
  if (!user.organisationId) {
    return NextResponse.json({ error: 'Account has no organisation' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Validate MIME type.
  const mimeType = file.type || 'application/octet-stream'
  if (!(ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return NextResponse.json(
      { error: `File type "${mimeType}" is not allowed` },
      { status: 415 },
    )
  }

  // Validate size.
  if (file.size > env.supportUploadMaxBytes) {
    const maxMb = (env.supportUploadMaxBytes / 1024 / 1024).toFixed(0)
    return NextResponse.json(
      { error: `File exceeds the ${maxMb} MB limit` },
      { status: 413 },
    )
  }

  // If a ticketId is provided, verify the user has access.
  const ticketId = formData.get('ticketId')
  if (ticketId && typeof ticketId === 'string') {
    const ticket = await db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.id, ticketId),
        eq(supportTickets.organisationId, user.organisationId),
      ),
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const originalName = file.name.replace(/[/\\]/g, '_').slice(0, 200)
  const ext = path.extname(originalName)

  // Insert DB record first to get the generated cuid2 id.
  const [attachment] = await db
    .insert(supportAttachments)
    .values({
      ticketId: typeof ticketId === 'string' ? ticketId : null,
      uploadedByUserId: user.id,
      filename: originalName,
      storagePath: 'pending',
      mimeType,
      sizeBytes: file.size,
    })
    .returning()

  if (!attachment) {
    return NextResponse.json({ error: 'Database insert failed' }, { status: 500 })
  }

  try {
    const { storagePath } = await uploadAttachment({
      id: attachment.id,
      ext,
      buffer,
      mimeType,
    })

    await db
      .update(supportAttachments)
      .set({ storagePath })
      .where(eq(supportAttachments.id, attachment.id))
  } catch (err) {
    // Clean up the orphaned DB row on storage failure.
    await db.delete(supportAttachments).where(eq(supportAttachments.id, attachment.id))
    const msg = err instanceof Error ? err.message : 'Storage error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({
    id: attachment.id,
    filename: originalName,
    mimeType,
    sizeBytes: file.size,
  })
}
