import { getDomainAccountCounts } from '@/lib/actions/domain-accounts'
import { LicenceRequiredError } from '@/lib/actions/licence-guard'
import { ApiAuthError, getApiSession } from '@/lib/auth/session'
import { EMPTY_DOMAIN_ACCOUNT_COUNTS } from '@/lib/standalone-empty-state'

export const dynamic = 'force-dynamic'

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
    const counts = await getDomainAccountCounts()
    return Response.json(counts)
  } catch (err) {
    if (err instanceof LicenceRequiredError) {
      return Response.json({ error: err.message }, { status: 402 })
    }
    throw err
  }
}
