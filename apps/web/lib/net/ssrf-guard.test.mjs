import test from 'node:test'
import assert from 'node:assert/strict'

import { assertPublicHost, assertPublicUrl, isPrivateIp } from './ssrf-guard.ts'

test('isPrivateIp flags private and reserved IPv4 ranges', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true)
  assert.equal(isPrivateIp('10.0.0.8'), true)
  assert.equal(isPrivateIp('172.16.1.5'), true)
  assert.equal(isPrivateIp('192.168.1.10'), true)
  assert.equal(isPrivateIp('169.254.10.20'), true)
  assert.equal(isPrivateIp('100.64.0.1'), true)
  assert.equal(isPrivateIp('8.8.8.8'), false)
})

test('isPrivateIp flags private and reserved IPv6 ranges', () => {
  assert.equal(isPrivateIp('::1'), true)
  assert.equal(isPrivateIp('::'), true)
  assert.equal(isPrivateIp('fc00::1'), true)
  assert.equal(isPrivateIp('fd12::1'), true)
  assert.equal(isPrivateIp('fe80::1'), true)
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false)
})

test('assertPublicHost rejects private and reserved literal addresses', async () => {
  await assert.rejects(() => assertPublicHost('127.0.0.1'), /private or reserved address/)
  await assert.rejects(() => assertPublicHost('::1'), /private or reserved address/)
  await assert.doesNotReject(() => assertPublicHost('8.8.8.8'))
})

test('assertPublicUrl rejects webhook targets on blocked addresses', async () => {
  await assert.rejects(
    () => assertPublicUrl('https://127.0.0.1/webhook'),
    /private or reserved address/,
  )
  await assert.rejects(
    () => assertPublicUrl('https://[::1]/webhook'),
    /private or reserved address/,
  )
  await assert.doesNotReject(() => assertPublicUrl('https://8.8.8.8/webhook'))
})
