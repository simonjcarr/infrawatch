import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLdapLoginOptions } from './ldap-login-options.ts'

test('buildLdapLoginOptions uses the integration name when an organisation has one login integration', () => {
  assert.deepEqual(
    buildLdapLoginOptions([
      {
        ldapConfigurationId: 'ldap_ctops',
        ldapConfigurationName: 'ctops',
        organisationName: 'CT-Ops',
        organisationSlug: 'ct-ops',
      },
    ]),
    [
      {
        id: 'ldap_ctops',
        organisationSlug: 'ct-ops',
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
        organisationName: 'Carrtech',
        organisationSlug: 'carrtech',
      },
      {
        ldapConfigurationId: 'ldap_backup',
        ldapConfigurationName: 'Backup AD',
        organisationName: 'Carrtech',
        organisationSlug: 'carrtech',
      },
    ]),
    [
      {
        id: 'ldap_primary',
        organisationSlug: 'carrtech',
        label: 'Primary AD',
      },
      {
        id: 'ldap_backup',
        organisationSlug: 'carrtech',
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
        organisationName: 'Acme',
        organisationSlug: 'acme',
      },
      {
        ldapConfigurationId: 'ldap_beta',
        ldapConfigurationName: 'Primary AD',
        organisationName: 'Beta',
        organisationSlug: 'beta',
      },
    ]),
    [
      {
        id: 'ldap_acme',
        organisationSlug: 'acme',
        label: 'Primary AD (Acme)',
      },
      {
        id: 'ldap_beta',
        organisationSlug: 'beta',
        label: 'Primary AD (Beta)',
      },
    ],
  )
})
