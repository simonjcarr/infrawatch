import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createHash } from 'node:crypto'

import {
  buildCtCveInventorySnapshot,
  pushCtCveInventorySnapshot,
} from './inventory-export.ts'

const generatedAt = new Date('2026-04-30T10:15:00.000Z')
const token = {
  id: 'ctops_inventory_token',
  secret: Buffer.from('ct-ops outbound inventory signing key only').toString('base64url'),
  orgId: 'org_1',
  scopes: ['inventory:write'],
}

function repo() {
  return {
    async getOrganisation(orgId) {
      assert.equal(orgId, 'org_1')
      return { id: 'org_1', slug: 'acme' }
    },
    async listInventoryHosts(orgId, options) {
      assert.equal(orgId, 'org_1')
      assert.equal(options.limit, 500)
      return [
        {
          id: 'host_1',
          hostname: 'web-01',
          displayName: 'Web 01',
          os: 'Ubuntu',
          osVersion: '24.04',
          arch: 'x86_64',
          status: 'online',
          lastSeenAt: new Date('2026-04-30T10:10:00.000Z'),
          updatedAt: new Date('2026-04-30T10:11:00.000Z'),
          deletedAt: null,
        },
        {
          id: 'host_deleted',
          hostname: 'retired',
          displayName: null,
          os: 'Ubuntu',
          osVersion: '22.04',
          arch: 'x86_64',
          status: 'offline',
          lastSeenAt: null,
          updatedAt: new Date('2026-04-30T09:00:00.000Z'),
          deletedAt: new Date('2026-04-30T09:30:00.000Z'),
        },
      ]
    },
    async listInventoryPackages(orgId, options) {
      assert.equal(orgId, 'org_1')
      assert.equal(options.limit, 25_000)
      return [
        {
          id: 'pkg_1',
          hostId: 'host_1',
          name: 'openssl',
          version: '3.0.13-0ubuntu3.2',
          architecture: 'amd64',
          source: 'dpkg',
          distroId: 'ubuntu',
          distroVersionId: '24.04',
          distroCodename: 'noble',
          distroIdLike: ['debian'],
          sourceName: 'openssl',
          sourceVersion: '3.0.13',
          packageEpoch: null,
          packageRelease: '0ubuntu3.2',
          repository: 'main',
          origin: 'Ubuntu',
          firstSeenAt: new Date('2026-04-29T08:00:00.000Z'),
          lastSeenAt: new Date('2026-04-30T10:10:00.000Z'),
          removedAt: null,
          deletedAt: null,
        },
        {
          id: 'pkg_removed',
          hostId: 'host_1',
          name: 'oldssl',
          version: '1.0.0',
          architecture: 'amd64',
          source: 'dpkg',
          distroId: 'ubuntu',
          distroVersionId: '24.04',
          distroCodename: 'noble',
          distroIdLike: [],
          sourceName: null,
          sourceVersion: null,
          packageEpoch: null,
          packageRelease: null,
          repository: null,
          origin: null,
          firstSeenAt: new Date('2026-04-29T08:00:00.000Z'),
          lastSeenAt: new Date('2026-04-29T09:00:00.000Z'),
          removedAt: new Date('2026-04-30T09:00:00.000Z'),
          deletedAt: null,
        },
      ]
    },
  }
}

function statusRepo() {
  let stored = null
  return {
    repository: {
      async get(orgId) {
        assert.equal(orgId, 'org_1')
        return stored
      },
      async save(status) {
        assert.equal(status.orgId, 'org_1')
        stored = status
      },
    },
    stored: () => stored,
  }
}

test('builds an org-scoped CT-CVE inventory snapshot without deleted or removed rows', async () => {
  const snapshot = await buildCtCveInventorySnapshot({
    orgId: 'org_1',
    repository: repo(),
    generatedAt,
  })

  assert.equal(snapshot.contractVersion, '2026-04-30')
  assert.equal(snapshot.orgId, 'org_1')
  assert.equal(snapshot.orgSlug, 'acme')
  assert.equal(snapshot.snapshotType, 'full')
  assert.equal(snapshot.generatedAt, generatedAt.toISOString())
  assert.equal(snapshot.hosts.length, 1)
  assert.equal(snapshot.packages.length, 1)
  assert.equal(snapshot.hosts[0].hostId, 'host_1')
  assert.equal(snapshot.packages[0].softwarePackageId, 'pkg_1')
  assert.equal(snapshot.packages[0].fingerprint, ['host_1', 'openssl', '3.0.13-0ubuntu3.2', 'amd64', 'dpkg'].join('\0'))
  assert.equal(snapshot.cursor, null)
})

test('adds an opaque cursor when either inventory page reaches its limit', async () => {
  const repository = repo()
  const snapshot = await buildCtCveInventorySnapshot({
    orgId: 'org_1',
    repository: {
      ...repository,
      async listInventoryHosts() {
        return [(await repository.listInventoryHosts('org_1', { limit: 500 }))[0]]
      },
    },
    limits: { hosts: 1, packages: 25_000 },
    generatedAt,
  })

  assert.match(snapshot.cursor ?? '', /^[A-Za-z0-9_-]+$/)
  const next = await buildCtCveInventorySnapshot({
    orgId: 'org_1',
    repository,
    cursor: snapshot.cursor ?? undefined,
    generatedAt,
  })
  assert.equal(next.snapshotType, 'full')
  assert.notEqual(next.snapshotId, snapshot.snapshotId)
})

test('pushes a snapshot to CT-CVE with the inventory service-token signature', async () => {
  const snapshot = await buildCtCveInventorySnapshot({
    orgId: 'org_1',
    repository: repo(),
    generatedAt,
  })

  let captured
  const status = statusRepo()
  const result = await pushCtCveInventorySnapshot({
    baseUrl: 'https://ct-cve.example.invalid',
    token,
    snapshot,
    nonce: 'nonce_inventory_1',
    timestamp: '2026-04-30T10:16:00.000Z',
    statusRepository: status.repository,
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return new Response(JSON.stringify({
        accepted: true,
        snapshotId: snapshot.snapshotId,
        hostsAccepted: 1,
        packagesAccepted: 1,
        rowsRejected: 0,
        nextAction: 'none',
      }), { status: 202, headers: { 'content-type': 'application/json' } })
    },
  })

  assert.equal(result.accepted, true)
  assert.equal(captured.url, 'https://ct-cve.example.invalid/api/v1/ct-ops/inventory-snapshots')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.headers.authorization, `CT-ServiceToken ${token.id}`)
  assert.equal(captured.init.headers['x-ct-content-sha256'], createHash('sha256').update(captured.init.body).digest('hex'))

  const expectedSignature = createHmac('sha256', token.secret)
    .update([
      'POST',
      '/api/v1/ct-ops/inventory-snapshots',
      '2026-04-30T10:16:00.000Z',
      'nonce_inventory_1',
      captured.init.headers['x-ct-content-sha256'],
    ].join('\n'))
    .digest('base64url')
  assert.equal(captured.init.headers['x-ct-signature'], `v1=${expectedSignature}`)
  assert.equal(status.stored().lastInventoryPushAt.length, '2026-04-30T10:16:00.000Z'.length)
  assert.equal(status.stored().lastErrorCode, null)
})

test('records a CT-CVE inventory connection error when the push fails', async () => {
  const snapshot = await buildCtCveInventorySnapshot({
    orgId: 'org_1',
    repository: repo(),
    generatedAt,
  })
  const status = statusRepo()

  await assert.rejects(() => pushCtCveInventorySnapshot({
    baseUrl: 'https://ct-cve.example.invalid',
    token,
    snapshot,
    statusRepository: status.repository,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }),
  }), /HTTP 503/)

  assert.equal(status.stored().lastErrorCode, 'inventory_push_failed')
  assert.equal(status.stored().lastErrorAt.length, '2026-04-30T10:16:00.000Z'.length)
})
