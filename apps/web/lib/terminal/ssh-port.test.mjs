import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_TERMINAL_SSH_PORT,
  getTerminalSshPortStorageKey,
  normaliseTerminalSshPort,
  parseTerminalSshPort,
} from './ssh-port.ts'

test('parseTerminalSshPort accepts a custom SSH port', () => {
  assert.deepEqual(parseTerminalSshPort('2222'), { ok: true, port: 2222 })
})

test('parseTerminalSshPort rejects missing or out-of-range ports', () => {
  assert.deepEqual(parseTerminalSshPort(''), { ok: false, error: 'SSH port is required' })
  assert.deepEqual(parseTerminalSshPort('0'), { ok: false, error: 'SSH port must be between 1 and 65535' })
  assert.deepEqual(parseTerminalSshPort('65536'), { ok: false, error: 'SSH port must be between 1 and 65535' })
})

test('parseTerminalSshPort rejects non-integer ports', () => {
  assert.deepEqual(parseTerminalSshPort('22.5'), { ok: false, error: 'SSH port must be a whole number' })
  assert.deepEqual(parseTerminalSshPort('abc'), { ok: false, error: 'SSH port must be a whole number' })
})

test('normaliseTerminalSshPort defaults missing or stale values to 22', () => {
  assert.equal(normaliseTerminalSshPort(undefined), DEFAULT_TERMINAL_SSH_PORT)
  assert.equal(normaliseTerminalSshPort(null), DEFAULT_TERMINAL_SSH_PORT)
  assert.equal(normaliseTerminalSshPort(2222), 2222)
  assert.equal(normaliseTerminalSshPort(65536), DEFAULT_TERMINAL_SSH_PORT)
})

test('getTerminalSshPortStorageKey scopes the saved port to a host', () => {
  assert.equal(getTerminalSshPortStorageKey('host-1'), 'terminal-ssh-port:host-1')
})
