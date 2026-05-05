import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterLdapConfigsForTenant,
  normalizeLdapTenantSlug,
} from './ldap-tenant.ts'

test('normalizeLdapTenantSlug accepts only organisation slugs', () => {
  assert.equal(normalizeLdapTenantSlug(' Acme-Operations '), 'acme-operations')
  assert.equal(normalizeLdapTenantSlug('acme_ldap'), null)
  assert.equal(normalizeLdapTenantSlug('../acme'), null)
  assert.equal(normalizeLdapTenantSlug(''), null)
  assert.equal(normalizeLdapTenantSlug(null), null)
})

test('filterLdapConfigsForTenant only returns login configs for the requested organisation slug', () => {
  const configs = [
    {
      id: 'ldap_acme',
      organisationId: 'org_acme',
      organisationSlug: 'acme',
      enabled: true,
      allowLogin: true,
      deletedAt: null,
    },
    {
      id: 'ldap_beta',
      organisationId: 'org_beta',
      organisationSlug: 'beta',
      enabled: true,
      allowLogin: true,
      deletedAt: null,
    },
    {
      id: 'ldap_acme_disabled',
      organisationId: 'org_acme',
      organisationSlug: 'acme',
      enabled: false,
      allowLogin: true,
      deletedAt: null,
    },
    {
      id: 'ldap_acme_no_login',
      organisationId: 'org_acme',
      organisationSlug: 'acme',
      enabled: true,
      allowLogin: false,
      deletedAt: null,
    },
    {
      id: 'ldap_acme_deleted',
      organisationId: 'org_acme',
      organisationSlug: 'acme',
      enabled: true,
      allowLogin: true,
      deletedAt: new Date('2026-05-05T00:00:00Z'),
    },
  ]

  assert.deepEqual(
    filterLdapConfigsForTenant(configs, 'ACME').map((config) => config.id),
    ['ldap_acme'],
  )
})
