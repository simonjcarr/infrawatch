import { getServiceAccountCounts } from '@/lib/actions/service-accounts'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/service-accounts/counts
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
    const counts = await getServiceAccountCounts()
    return Response.json(counts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
