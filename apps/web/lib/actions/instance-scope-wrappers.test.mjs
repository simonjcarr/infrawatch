import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const checksSource = readFileSync(path.join(here, 'checks.ts'), 'utf8')
const hostGroupsSource = readFileSync(path.join(here, 'host-groups.ts'), 'utf8')
const networksSource = readFileSync(path.join(here, 'networks.ts'), 'utf8')
const notesSource = readFileSync(path.join(here, 'notes.ts'), 'utf8')
const serviceAccountsSource = readFileSync(path.join(here, 'service-accounts.ts'), 'utf8')
const softwareInventorySource = readFileSync(path.join(here, 'software-inventory.ts'), 'utf8')
const tagsSource = readFileSync(path.join(here, 'tags.ts'), 'utf8')
const terminalSource = readFileSync(path.join(here, 'terminal.ts'), 'utf8')

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

test('host groups wrapper derives instance scope from the current session', () => {
  assert.match(hostGroupsSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(hostGroupsSource, /\borgId\b/)
})

test('networks wrapper derives instance scope from the current session', () => {
  assert.match(networksSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(networksSource, /\borgId\b/)
})

test('notes wrapper derives instance scope from the current session', () => {
  assert.match(notesSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(notesSource, /\borgId\b/)
})

test('tags wrapper derives instance scope from the current session', () => {
  assert.match(tagsSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(tagsSource, /\borgId\b/)
})

test('terminal wrapper derives instance scope from the current session', () => {
  assert.match(terminalSource, /resolveCurrentActionScope\(session\)/)
  assert.doesNotMatch(terminalSource, /\borgId\b/)
})
