import { NextRequest, NextResponse } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import {
  verifyCtCveServiceRequest,
  type CtCveServiceAuthError,
} from '@/lib/integrations/ct-cve/service-token'
import { getCtCveServiceTokensForInstance } from '@/lib/integrations/ct-cve/connector-settings'
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
  const instanceId = request.nextUrl.searchParams.get('instanceId')?.trim()
  if (!instanceId) {
    return NextResponse.json(
      {
        error: {
          code: 'missing_instance_id',
          message: 'instanceId query parameter is required.',
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  const tokens = await getCtCveServiceTokensForInstance(instanceId)
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
    instanceId,
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

  const status = await recordCtCveConnectionHealth(auth.token.instanceId)
  return NextResponse.json(status)
}
