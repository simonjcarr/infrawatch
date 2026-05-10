import { getCertificateCounts } from '@/lib/actions/certificates'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiSession } from '@/lib/auth/session'
import { EMPTY_CERTIFICATE_COUNTS } from '@/lib/standalone-empty-state'

export const dynamic = 'force-dynamic'

// GET /api/certificates/counts
export async function GET() {
  let session
  try {
    session = await getApiSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  try {
    const counts = await getCertificateCounts()
    return Response.json(counts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
