import test from 'node:test'
import assert from 'node:assert/strict'

import { ingestCtCveFindingBatch } from './finding-ingest.ts'

const generatedAt = '2026-04-30T09:20:00.000Z'

function finding(overrides = {}) {
  return {
    findingId: 'ctcve_find_1',
    hostId: 'host_1',
    softwarePackageId: 'pkg_1',
    cveId: 'CVE-2026-12345',
    status: 'open',
    packageName: 'openssl',
    installedVersion: '3.0.13-0ubuntu3.2',
    fixedVersion: '3.0.13-0ubuntu3.3',
    source: 'ubuntu-osv',
    severity: 'high',
    cvssScore: 8.1,
    knownExploited: false,
    confidence: 'confirmed',
    matchReason: 'installed version is lower than fixed version',
    firstSeenAt: generatedAt,
    lastSeenAt: generatedAt,
    resolvedAt: null,
    cve: {
      title: 'OpenSSL vulnerability',
      description: 'Short normalized summary.',
      publishedAt: '2026-04-25T00:00:00.000Z',
      modifiedAt: '2026-04-29T00:00:00.000Z',
      rejected: false,
    },
    references: ['https://example.invalid/advisories/CVE-2026-12345'],
    metadata: { advisoryIds: ['USN-0000-1'] },
    ...overrides,
  }
}

function batch(findings = [finding()], overrides = {}) {
  return {
    contractVersion: '2026-04-30',
    orgId: 'org_1',
    batchId: 'findings_20260430_092000_org_1',
    generatedAt,
    findings,
    ...overrides,
  }
}

function repo(overrides = {}) {
  const state = {
    hosts: new Map([['host_1', { id: 'host_1', organisationId: 'org_1', deletedAt: null }]]),
    packages: new Map([['pkg_1', { id: 'pkg_1', organisationId: 'org_1', hostId: 'host_1', removedAt: null, deletedAt: null }]]),
    existing: new Map(),
    cves: [],
    findings: [],
  }

  return {
    state,
    repository: {
      async transaction(run) {
        return run(this)
      },
      async getHosts(_orgId, hostIds) {
        return new Map(hostIds.map((id) => [id, state.hosts.get(id)]).filter(([, value]) => value))
      },
      async getSoftwarePackages(_orgId, packageIds) {
        return new Map(packageIds.map((id) => [id, state.packages.get(id)]).filter(([, value]) => value))
      },
      async getExistingFindings(_orgId, keys) {
        return new Map(keys.map((key) => [key.join('\0'), state.existing.get(key.join('\0'))]).filter(([, value]) => value))
      },
      async upsertCve(cve) {
        state.cves.push(cve)
      },
      async upsertFinding(input) {
        state.findings.push(input)
      },
      ...overrides,
    },
  }
}

test('ingests a valid CT-CVE finding batch', async () => {
  const { state, repository } = repo()

  const result = await ingestCtCveFindingBatch(batch(), { repository })

  assert.deepEqual(result, {
    accepted: true,
    batchId: 'findings_20260430_092000_org_1',
    findingsAccepted: 1,
    findingsRejected: 0,
    findingsSkipped: 0,
  })
  assert.equal(state.cves.length, 1)
  assert.equal(state.findings.length, 1)
  assert.equal(state.findings[0].metadata.ctCveFindingId, 'ctcve_find_1')
  assert.equal(state.findings[0].metadata.ctCveBatchId, 'findings_20260430_092000_org_1')
})

test('rejects open findings for unknown or deleted hosts and inactive packages', async () => {
  const { repository } = repo()

  const result = await ingestCtCveFindingBatch(batch([
    finding({ findingId: 'unknown_host', hostId: 'missing', softwarePackageId: 'pkg_1' }),
    finding({ findingId: 'inactive_package', softwarePackageId: 'missing' }),
  ]), { repository })

  assert.equal(result.accepted, false)
  assert.equal(result.findingsAccepted, 0)
  assert.equal(result.findingsRejected, 2)
  assert.deepEqual(result.rejections?.map((rejection) => rejection.code), [
    'unknown_host',
    'unknown_software_package',
  ])
})

test('skips stale deliveries so an old replay cannot regress newer finding state', async () => {
  const stale = finding({ lastSeenAt: '2026-04-30T09:00:00.000Z' })
  const { state, repository } = repo()
  state.existing.set('host_1\0pkg_1\0CVE-2026-12345', {
    lastSeenAt: new Date('2026-04-30T09:30:00.000Z'),
  })

  const result = await ingestCtCveFindingBatch(batch([stale]), { repository })

  assert.equal(result.accepted, true)
  assert.equal(result.findingsAccepted, 0)
  assert.equal(result.findingsRejected, 0)
  assert.equal(result.findingsSkipped, 1)
  assert.equal(state.findings.length, 0)
})
