import test from 'node:test'
import assert from 'node:assert/strict'

import { sanitiseLdapConfigurationForClient } from './config-client.ts'

test('sanitiseLdapConfigurationForClient omits bindPassword from client payloads', () => {
  const safe = sanitiseLdapConfigurationForClient({
    id: 'cfg_123',
    organisationId: 'org_123',
    name: 'Primary LDAP',
    host: 'ldap.example.com',
    port: 636,
    useTls: true,
    useStartTls: false,
    tlsCertificate: 'stored-cert',
    baseDn: 'dc=example,dc=com',
    bindDn: 'stored-bind-dn',
    bindPassword: 'stored-ciphertext',
    userSearchBase: null,
    userSearchFilter: '(uid={{username}})',
    groupSearchBase: null,
    groupSearchFilter: null,
    usernameAttribute: 'uid',
    emailAttribute: 'mail',
    displayNameAttribute: 'cn',
    enabled: true,
    allowLogin: true,
    createdAt: new Date('2026-04-18T15:32:43Z'),
    updatedAt: new Date('2026-04-18T15:32:43Z'),
    deletedAt: null,
  })

  assert.equal('bindPassword' in safe, false)
  assert.equal(safe.name, 'Primary LDAP')
  assert.equal(safe.host, 'ldap.example.com')
})
