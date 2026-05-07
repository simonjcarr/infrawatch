import test from 'node:test'
import assert from 'node:assert/strict'

import { isDnWithinSearchBase, resolveSearchBase } from './dn-scope.ts'

test('resolveSearchBase appends relative user search bases to the configured base DN', () => {
  assert.equal(
    resolveSearchBase('ou=People', 'dc=example,dc=com'),
    'ou=People,dc=example,dc=com',
  )
})

test('resolveSearchBase preserves absolute user search bases under the configured base DN', () => {
  assert.equal(
    resolveSearchBase('ou=People,dc=example,dc=com', 'dc=example,dc=com'),
    'ou=People,dc=example,dc=com',
  )
})

test('isDnWithinSearchBase allows a DN below the configured user search base', () => {
  assert.equal(
    isDnWithinSearchBase(
      'cn=Alice,ou=People,dc=example,dc=com',
      { baseDn: 'dc=example,dc=com', userSearchBase: 'ou=People' },
    ),
    true,
  )
})

test('isDnWithinSearchBase rejects sibling OUs under the directory base DN', () => {
  assert.equal(
    isDnWithinSearchBase(
      'cn=Service,ou=Privileged,dc=example,dc=com',
      { baseDn: 'dc=example,dc=com', userSearchBase: 'ou=People' },
    ),
    false,
  )
})

test('isDnWithinSearchBase rejects parent and root DNs', () => {
  assert.equal(
    isDnWithinSearchBase(
      'dc=example,dc=com',
      { baseDn: 'dc=example,dc=com', userSearchBase: 'ou=People' },
    ),
    false,
  )
})

test('isDnWithinSearchBase rejects malformed DNs', () => {
  assert.equal(
    isDnWithinSearchBase(
      'cn=Alice,ou=People,dc=example,dc=com\\',
      { baseDn: 'dc=example,dc=com', userSearchBase: 'ou=People' },
    ),
    false,
  )
})

test('isDnWithinSearchBase handles escaped comma and equals signs inside attribute values', () => {
  assert.equal(
    isDnWithinSearchBase(
      'cn=Doe\\, Jane\\=Admin,ou=People,dc=example,dc=com',
      { baseDn: 'dc=example,dc=com', userSearchBase: 'ou=People' },
    ),
    true,
  )
})
