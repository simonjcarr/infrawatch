import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAuthenticateUserSearchFilter } from './auth-filter.ts'

test('buildAuthenticateUserSearchFilter preserves the configured username filter', () => {
  assert.equal(
    buildAuthenticateUserSearchFilter('(sAMAccountName={{username}})', 'simon.carr'),
    '(sAMAccountName=simon.carr)',
  )
})

test('buildAuthenticateUserSearchFilter allows Active Directory UPN logins', () => {
  assert.equal(
    buildAuthenticateUserSearchFilter('(sAMAccountName={{username}})', 'simon.carr@carrtech.local'),
    '(|(sAMAccountName=simon.carr@carrtech.local)(userPrincipalName=simon.carr@carrtech.local)(sAMAccountName=simon.carr))',
  )
})

test('buildAuthenticateUserSearchFilter escapes UPN local parts before interpolation', () => {
  assert.equal(
    buildAuthenticateUserSearchFilter('(sAMAccountName={{username}})', 'sim(on)*@carrtech.local'),
    '(|(sAMAccountName=sim\\28on\\29\\2a@carrtech.local)(userPrincipalName=sim\\28on\\29\\2a@carrtech.local)(sAMAccountName=sim\\28on\\29\\2a))',
  )
})
