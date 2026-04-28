import test from 'node:test'
import assert from 'node:assert/strict'

import * as hostsModule from './hosts.ts'
import * as organisationsModule from './organisations.ts'

const { parseHostMetadata } = hostsModule
const { parseOrgMetadata } = organisationsModule

test('parseHostMetadata strips unknown fields and falls back on malformed values', () => {
  const parsed = parseHostMetadata({
    disks: [
      {
        mount_point: '/',
        device: '/dev/vda1',
        fs_type: 'ext4',
        total_bytes: 100,
        used_bytes: 50,
        free_bytes: 50,
        percent_used: 50,
        unexpected: 'drop-me',
      },
    ],
    network_interfaces: 'not-an-array',
    terminalAllowedUsers: [123, 'user-2'],
    collectionSettings: {
      cpu: 'yes',
      memory: false,
      disk: true,
      localUsers: true,
      localUserConfig: {
        mode: 'selected',
        selectedUsernames: ['alice'],
        extra: true,
      },
    },
    injected: { admin: true },
  })

  assert.deepEqual(parsed.disks, [{
    mount_point: '/',
    device: '/dev/vda1',
    fs_type: 'ext4',
    total_bytes: 100,
    used_bytes: 50,
    free_bytes: 50,
    percent_used: 50,
  }])
  assert.deepEqual(parsed.network_interfaces, [])
  assert.deepEqual(parsed.terminalAllowedUsers, [])
  assert.deepEqual(parsed.collectionSettings, {
    cpu: true,
    memory: false,
    disk: true,
    localUsers: true,
    localUserConfig: {
      mode: 'selected',
      selectedUsernames: ['alice'],
    },
  })
  assert.equal('injected' in parsed, false)
})

test('parseOrgMetadata preserves valid settings and drops malformed nested metadata', () => {
  const parsed = parseOrgMetadata({
    defaultTags: [
      { key: 'env', value: 'prod', extra: 'drop-me' },
      { key: 42, value: 'bad' },
    ],
    notificationSettings: {
      inAppEnabled: true,
      inAppRoles: 'super_admin',
      allowUserOptOut: false,
    },
    softwareInventorySettings: {
      enabled: true,
      intervalHours: 24,
      includeSnapFlatpak: 'yes',
    },
  })

  assert.deepEqual(parsed.defaultTags, [])
  assert.deepEqual(parsed.notificationSettings, {
    inAppEnabled: true,
    inAppRoles: ['super_admin', 'org_admin', 'engineer'],
    allowUserOptOut: false,
  })
  assert.deepEqual(parsed.softwareInventorySettings, {
    enabled: true,
    intervalHours: 24,
    includeSnapFlatpak: undefined,
  })
})
