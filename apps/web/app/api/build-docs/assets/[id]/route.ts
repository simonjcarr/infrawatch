import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession } from '@/lib/auth/session'
import { getBuildDocAssetBytes } from '@/lib/actions/build-docs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session: Awaited<ReturnType<typeof getRequiredSession>>
  try {
    session = await getRequiredSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgId = session.user.organisationId
  if (!orgId) return NextResponse.json({ error: 'No organisation' }, { status: 403 })

  const { id } = await params
  const result = await getBuildDocAssetBytes(orgId, id)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': result.asset.contentType,
      'Content-Length': String(result.bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
