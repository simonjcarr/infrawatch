import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createHash } from 'node:crypto'

import {
  createInMemoryCtCveNonceStore,
  parseCtCveServiceTokens,
  verifyCtCveServiceRequest,
} from './service-token.ts'

const TOKEN = {
  id: 'ctcve_test_token',
  secret: Buffer.from('ct-cve unit test signing key only').toString('base64url'),
  instanceId: 'org_123',
  scopes: ['findings:write', 'connection:read'],
}

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function sign({ method = 'POST', path = '/api/integrations/ct-cve/v1/finding-batches', timestamp, nonce, bodyHash }) {
  const input = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
  return createHmac('sha256', TOKEN.secret).update(input).digest('base64url')
}

function signedHeaders({ body = '{}', timestamp = '2026-04-30T09:20:00.000Z', nonce = 'nonce_1', signature } = {}) {
  const bodyHash = sha256(body)
  return {
    authorization: `CT-ServiceToken ${TOKEN.id}`,
    'x-ct-timestamp': timestamp,
    'x-ct-nonce': nonce,
    'x-ct-content-sha256': bodyHash,
    'x-ct-signature': `v1=${signature ?? sign({ timestamp, nonce, bodyHash })}`,
  }
}

test('accepts a correctly signed CT-CVE service request', async () => {
  const body = JSON.stringify({ instanceId: TOKEN.instanceId })
  const result = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body }),
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.token.instanceId, TOKEN.instanceId)
})

test('rejects replayed nonces within the replay window', async () => {
  const nonceStore = createInMemoryCtCveNonceStore()
  const body = JSON.stringify({ instanceId: TOKEN.instanceId })
  const headers = signedHeaders({ body })
  const request = {
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers,
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore,
  }

  assert.equal((await verifyCtCveServiceRequest(request)).ok, true)
  const replay = await verifyCtCveServiceRequest(request)
  assert.equal(replay.ok, false)
  assert.equal(!replay.ok && replay.error.code, 'replayed_nonce')
})

test('accepts connection-health requests with the connection read scope', async () => {
  const result = await verifyCtCveServiceRequest({
    method: 'GET',
    path: '/api/integrations/ct-cve/v1/connection-health',
    body: '',
    headers: signedHeaders({
      body: '',
      nonce: 'nonce_connection_health',
      signature: sign({
        method: 'GET',
        path: '/api/integrations/ct-cve/v1/connection-health',
        timestamp: '2026-04-30T09:20:00.000Z',
        nonce: 'nonce_connection_health',
        bodyHash: sha256(''),
      }),
    }),
    requiredScope: 'connection:read',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })

  assert.equal(result.ok, true)
})

test('rejects stale timestamps', async () => {
  const body = JSON.stringify({ instanceId: TOKEN.instanceId })
  const timestamp = '2026-04-30T09:00:00.000Z'
  const result = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body, timestamp }),
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.error.code, 'timestamp_out_of_range')
})

test('rejects body hash mismatches before signature verification', async () => {
  const result = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body: JSON.stringify({ instanceId: TOKEN.instanceId, changed: true }),
    headers: signedHeaders({ body: JSON.stringify({ instanceId: TOKEN.instanceId }) }),
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.error.code, 'content_hash_mismatch')
})

test('rejects invalid signatures without recording the nonce', async () => {
  const nonceStore = createInMemoryCtCveNonceStore()
  const body = JSON.stringify({ instanceId: TOKEN.instanceId })
  const bad = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body, signature: 'bad_signature' }),
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore,
  })

  assert.equal(bad.ok, false)
  assert.equal(!bad.ok && bad.error.code, 'invalid_signature')

  const good = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body }),
    requiredScope: 'findings:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore,
  })

  assert.equal(good.ok, true)
})

test('rejects tokens without the required scope or instance binding', async () => {
  const body = JSON.stringify({ instanceId: TOKEN.instanceId })

  const wrongScope = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body, nonce: 'nonce_scope' }),
    requiredScope: 'inventory:write',
    instanceId: TOKEN.instanceId,
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })
  assert.equal(wrongScope.ok, false)
  assert.equal(!wrongScope.ok && wrongScope.error.code, 'insufficient_scope')

  const wrongOrg = await verifyCtCveServiceRequest({
    method: 'POST',
    path: '/api/integrations/ct-cve/v1/finding-batches',
    body,
    headers: signedHeaders({ body, nonce: 'nonce_org' }),
    requiredScope: 'findings:write',
    instanceId: 'org_other',
    now: new Date('2026-04-30T09:20:30.000Z'),
    tokens: [TOKEN],
    nonceStore: createInMemoryCtCveNonceStore(),
  })
  assert.equal(wrongOrg.ok, false)
  assert.equal(!wrongOrg.ok && wrongOrg.error.code, 'org_scope_mismatch')
})

test('parses configured CT-CVE service tokens and rejects weak secrets', () => {
  const tokens = parseCtCveServiceTokens(JSON.stringify([
    {
      id: TOKEN.id,
      secret: TOKEN.secret,
      instanceId: TOKEN.instanceId,
      scopes: ['findings:write', 'connection:read', 'unsupported'],
    },
  ]))

  assert.deepEqual(tokens, [{ ...TOKEN, revoked: false }])
  assert.throws(
    () => parseCtCveServiceTokens(JSON.stringify([{
      id: 'weak',
      secret: 'short',
      instanceId: TOKEN.instanceId,
      scopes: ['findings:write'],
    }])),
    /secret must contain at least 32 bytes/,
  )
})
