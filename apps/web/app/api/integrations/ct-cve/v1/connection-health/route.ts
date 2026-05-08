import { NextRequest, NextResponse } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import {
  verifyCtCveServiceRequest,
  type CtCveServiceAuthError,
} from '@/lib/integrations/ct-cve/service-token'
import { getCtCveServiceTokensForOrg } from '@/lib/integrations/ct-cve/connector-settings'
import { recordCtCveConnectionHealth } from '@/lib/integrations/ct-cve/connection-status'

export const dynamic = 'force-dynamic'

const healthRateLimiter = createRateLimiter({
  scope: 'ct-cve:connection-health',
  windowMs: 60_000,
  max: 60,
})

function serviceError(error: CtCveServiceAuthError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    },
    { status: error.status },
  )
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')?.trim()
  if (!orgId) {
    return NextResponse.json(
      {
        error: {
          code: 'missing_org_id',
          message: 'orgId query parameter is required.',
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  const tokens = await getCtCveServiceTokensForOrg(orgId)
  if (tokens.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'ct_cve_not_configured',
          message: 'CT-CVE service tokens are not configured.',
          retryable: false,
        },
      },
      { status: 503 },
    )
  }

  const auth = await verifyCtCveServiceRequest({
    method: request.method,
    path: request.nextUrl.pathname,
    body: '',
    headers: request.headers,
    requiredScope: 'connection:read',
    orgId,
    tokens,
  })

  if (!auth.ok) {
    return serviceError(auth.error)
  }

  if (!(await healthRateLimiter.check(auth.token.id))) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message: 'CT-CVE connection health rate limit exceeded.',
          retryable: true,
        },
      },
      {
        status: 429,
        headers: { 'Retry-After': '60' },
      },
    )
  }

  const status = await recordCtCveConnectionHealth(auth.token.orgId)
  return NextResponse.json(status)
}
