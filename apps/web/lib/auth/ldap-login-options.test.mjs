import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLdapLoginOptions } from './ldap-login-options.ts'

test('buildLdapLoginOptions uses the integration name when there is one login integration', () => {
  assert.deepEqual(
    buildLdapLoginOptions([
      {
        ldapConfigurationId: 'ldap_ctops',
        ldapConfigurationName: 'ctops',
        ldapConfigurationHost: 'ldap.ct-ops.example',
      },
    ]),
    [
      {
        id: 'ldap_ctops',
        label: 'ctops',
      },
    ],
  )
})

test('buildLdapLoginOptions returns each login integration as a selectable option', () => {
  assert.deepEqual(
    buildLdapLoginOptions([
      {
        ldapConfigurationId: 'ldap_primary',
        ldapConfigurationName: 'Primary AD',
        ldapConfigurationHost: 'ldap1.carrtech.example',
      },
      {
        ldapConfigurationId: 'ldap_backup',
        ldapConfigurationName: 'Backup AD',
        ldapConfigurationHost: 'ldap2.carrtech.example',
      },
    ]),
    [
      {
        id: 'ldap_primary',
        label: 'Primary AD',
      },
      {
        id: 'ldap_backup',
        label: 'Backup AD',
      },
    ],
  )
})

test('buildLdapLoginOptions disambiguates duplicate integration names', () => {
  assert.deepEqual(
    buildLdapLoginOptions([
      {
        ldapConfigurationId: 'ldap_acme',
        ldapConfigurationName: 'Primary AD',
        ldapConfigurationHost: 'dc1.acme.example',
      },
      {
        ldapConfigurationId: 'ldap_beta',
        ldapConfigurationName: 'Primary AD',
        ldapConfigurationHost: 'dc1.beta.example',
      },
    ]),
    [
      {
        id: 'ldap_acme',
        label: 'Primary AD (dc1.acme.example)',
      },
      {
        id: 'ldap_beta',
        label: 'Primary AD (dc1.beta.example)',
      },
    ],
  )
})
