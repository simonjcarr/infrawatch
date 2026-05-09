import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const checksSource = readFileSync(path.join(here, 'checks.ts'), 'utf8')
const serviceAccountsSource = readFileSync(path.join(here, 'service-accounts.ts'), 'utf8')
const softwareInventorySource = readFileSync(path.join(here, 'software-inventory.ts'), 'utf8')

test('checks wrapper derives instance scope from the current session', () => {
  assert.match(checksSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(checksSource, /\borgId\b/)
})

test('service accounts wrapper derives instance scope from the current session', () => {
  assert.match(serviceAccountsSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(serviceAccountsSource, /\borgId\b/)
})

test('software inventory wrapper derives instance scope from the current session', () => {
  assert.match(softwareInventorySource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(softwareInventorySource, /\borgId\b/)
})
