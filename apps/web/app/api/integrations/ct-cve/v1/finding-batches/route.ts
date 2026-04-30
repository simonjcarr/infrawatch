import { NextRequest, NextResponse } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import {
  getConfiguredCtCveServiceTokens,
  verifyCtCveServiceRequest,
  type CtCveServiceAuthError,
} from '@/lib/integrations/ct-cve/service-token'
import {
  CtCveFindingBatchValidationError,
  ingestCtCveFindingBatch,
} from '@/lib/integrations/ct-cve/finding-ingest'
import {
  recordCtCveConnectionError,
  recordCtCveFindingIngest,
} from '@/lib/integrations/ct-cve/connection-status'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 25 * 1024 * 1024

const findingBatchRateLimiter = createRateLimiter({
  scope: 'ct-cve:finding-batches',
  windowMs: 60_000,
  max: 120,
})

function errorResponse(error: { code: string; message: string; retryable: boolean }, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers })
}

function serviceError(error: CtCveServiceAuthError) {
  return errorResponse({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  }, error.status)
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse({
      code: 'payload_too_large',
      message: 'CT-CVE finding batch payload exceeds the 25 MiB limit.',
      retryable: false,
    }, 413)
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return errorResponse({
      code: 'invalid_json',
      message: 'CT-CVE finding batch payload must be valid JSON.',
      retryable: false,
    }, 400)
  }

  const orgId = typeof payload === 'object' && payload && 'orgId' in payload
    ? String((payload as { orgId?: unknown }).orgId ?? '').trim()
    : ''
  if (!orgId) {
    return errorResponse({
      code: 'missing_org_id',
      message: 'CT-CVE finding batch payload must include orgId.',
      retryable: false,
    }, 400)
  }

  const tokens = getConfiguredCtCveServiceTokens()
  if (tokens.length === 0) {
    return errorResponse({
      code: 'ct_cve_not_configured',
      message: 'CT-CVE service tokens are not configured.',
      retryable: false,
    }, 503)
  }

  const auth = await verifyCtCveServiceRequest({
    method: request.method,
    path: request.nextUrl.pathname,
    body,
    headers: request.headers,
    requiredScope: 'findings:write',
    orgId,
    tokens,
  })

  if (!auth.ok) {
    return serviceError(auth.error)
  }

  if (!(await findingBatchRateLimiter.check(auth.token.id))) {
    return errorResponse({
      code: 'rate_limited',
      message: 'CT-CVE finding batch rate limit exceeded.',
      retryable: true,
    }, 429, { 'Retry-After': '60' })
  }

  try {
    const result = await ingestCtCveFindingBatch(payload)
    await recordCtCveFindingIngest(auth.token.orgId)
    return NextResponse.json(result, { status: result.accepted ? 202 : 207 })
  } catch (error) {
    if (error instanceof CtCveFindingBatchValidationError) {
      await recordCtCveConnectionError(auth.token.orgId, 'invalid_finding_batch')
      return errorResponse({
        code: 'invalid_payload',
        message: error.issues.join('; '),
        retryable: false,
      }, 400)
    }
    throw error
  }
}
