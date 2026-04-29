import { getServiceAccountCounts } from '@/lib/actions/service-accounts'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/service-accounts/counts
export async function GET() {
  let session
  try {
    session = await getApiOrgSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  try {
    const counts = await getServiceAccountCounts(session.user.organisationId)
    return Response.json(counts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
