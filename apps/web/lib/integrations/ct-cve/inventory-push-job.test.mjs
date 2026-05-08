import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCtCveInventoryPushTargets,
  runCtCveInventoryPushes,
} from './inventory-push-job.ts'

const token = {
  id: 'ctops_inventory_token',
  secret: Buffer.from('ct-ops outbound inventory signing key only').toString('base64url'),
  orgId: 'org_1',
  scopes: ['inventory:write'],
}

test('parses enabled CT-CVE inventory push targets', () => {
  const targets = parseCtCveInventoryPushTargets(JSON.stringify([
    {
      name: 'prod',
      baseUrl: 'https://ct-cve.example.invalid/',
      token,
    },
    {
      name: 'disabled',
      enabled: false,
      baseUrl: 'https://disabled.example.invalid',
      token: { ...token, id: 'disabled_token' },
    },
  ]))

  assert.equal(targets.length, 1)
  assert.equal(targets[0].name, 'prod')
  assert.equal(targets[0].baseUrl, 'https://ct-cve.example.invalid')
  assert.equal(targets[0].token.id, 'ctops_inventory_token')
})

test('rejects malformed CT-CVE inventory push targets', () => {
  assert.throws(
    () => parseCtCveInventoryPushTargets(JSON.stringify([
      {
        name: 'bad',
        baseUrl: 'not a url',
        token: { ...token, secret: 'short' },
      },
    ])),
    /CT_CVE_INVENTORY_PUSH_TARGETS\[0\]/,
  )
})

test('pushes every paged inventory snapshot for configured targets', async () => {
  const snapshots = []
  const pushes = []
  const statusRepository = {
    async get() {
      return null
    },
    async save() {},
  }

  const result = await runCtCveInventoryPushes({
    targets: [{
      name: 'prod',
      enabled: true,
      baseUrl: 'https://ct-cve.example.invalid',
      token,
    }],
    buildSnapshot: async ({ orgId, cursor, snapshotType }) => {
      snapshots.push({ orgId, cursor, snapshotType })
      return {
        contractVersion: '2026-04-30',
        orgId,
        orgSlug: 'acme',
        snapshotId: cursor ? 'snapshot_page_2' : 'snapshot_page_1',
        snapshotType,
        generatedAt: '2026-04-30T10:00:00.000Z',
        cursor: cursor ? null : 'next-page',
        hosts: cursor ? [] : [{ hostId: 'host_1' }],
        packages: cursor ? [{ softwarePackageId: 'pkg_2' }] : [{ softwarePackageId: 'pkg_1' }],
      }
    },
    pushSnapshot: async ({ baseUrl, token: pushToken, snapshot }) => {
      pushes.push({ baseUrl, token: pushToken, snapshot })
      return {
        accepted: true,
        snapshotId: snapshot.snapshotId,
        hostsAccepted: snapshot.hosts.length,
        packagesAccepted: snapshot.packages.length,
        rowsRejected: 0,
        nextAction: 'none',
      }
    },
    statusRepository,
  })

  assert.deepEqual(snapshots, [
    { orgId: 'org_1', cursor: undefined, snapshotType: 'full' },
    { orgId: 'org_1', cursor: 'next-page', snapshotType: 'full' },
  ])
  assert.equal(pushes.length, 2)
  assert.equal(pushes[0].baseUrl, 'https://ct-cve.example.invalid')
  assert.equal(pushes[0].token.id, token.id)
  assert.deepEqual(result, {
    targetsConfigured: 1,
    targetsPushed: 1,
    snapshotsPushed: 2,
    hostsAccepted: 1,
    packagesAccepted: 2,
    rowsRejected: 0,
    failures: [],
  })
})

test('loads CT-CVE inventory push targets from app settings when no explicit targets are passed', async () => {
  const pushes = []
  const result = await runCtCveInventoryPushes({
    env: { CT_CVE_INVENTORY_PUSH_TARGETS: '[]' },
    loadTargets: async (env) => {
      assert.equal(env.CT_CVE_INVENTORY_PUSH_TARGETS, '[]')
      return [{
        name: 'app settings target',
        enabled: true,
        baseUrl: 'https://ct-cve.example.invalid',
        token,
      }]
    },
    buildSnapshot: async ({ orgId }) => ({
      contractVersion: '2026-04-30',
      orgId,
      orgSlug: 'acme',
      snapshotId: 'snapshot',
      snapshotType: 'full',
      generatedAt: '2026-04-30T10:00:00.000Z',
      cursor: null,
      hosts: [],
      packages: [],
    }),
    pushSnapshot: async ({ baseUrl, token: pushToken }) => {
      pushes.push({ baseUrl, token: pushToken })
      return {
        accepted: true,
        snapshotId: 'snapshot',
        hostsAccepted: 0,
        packagesAccepted: 0,
        rowsRejected: 0,
        nextAction: 'none',
      }
    },
    statusRepository: {
      async get() {
        return null
      },
      async save() {},
    },
  })

  assert.equal(pushes.length, 1)
  assert.equal(pushes[0].baseUrl, 'https://ct-cve.example.invalid')
  assert.equal(result.targetsConfigured, 1)
  assert.equal(result.targetsPushed, 1)
})

test('reports target failures without stopping later targets', async () => {
  const result = await runCtCveInventoryPushes({
    targets: [
      {
        name: 'broken',
        enabled: true,
        baseUrl: 'https://broken.example.invalid',
        token,
      },
      {
        name: 'prod',
        enabled: true,
        baseUrl: 'https://ct-cve.example.invalid',
        token: { ...token, id: 'ctops_inventory_token_2' },
      },
    ],
    buildSnapshot: async ({ orgId }) => ({
      contractVersion: '2026-04-30',
      orgId,
      orgSlug: 'acme',
      snapshotId: 'snapshot',
      snapshotType: 'full',
      generatedAt: '2026-04-30T10:00:00.000Z',
      cursor: null,
      hosts: [],
      packages: [],
    }),
    pushSnapshot: async ({ token: pushToken }) => {
      if (pushToken.id === 'ctops_inventory_token') {
        throw new Error('upstream unavailable')
      }
      return {
        accepted: true,
        snapshotId: 'snapshot',
        hostsAccepted: 0,
        packagesAccepted: 0,
        rowsRejected: 0,
        nextAction: 'none',
      }
    },
    statusRepository: {
      async get() {
        return null
      },
      async save() {},
    },
  })

  assert.equal(result.targetsConfigured, 2)
  assert.equal(result.targetsPushed, 1)
  assert.equal(result.snapshotsPushed, 1)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].target, 'broken')
  assert.match(result.failures[0].message, /upstream unavailable/)
})
