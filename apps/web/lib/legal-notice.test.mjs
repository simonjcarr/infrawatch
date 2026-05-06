import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('legal notice page covers operational software risk and customer responsibility', () => {
  const page = readFileSync(new URL('../app/(dashboard)/legal-notice/page.tsx', import.meta.url), 'utf8')

  assert.match(page, /use CT-Ops at your own risk/i)
  assert.match(page, /loss of profit/i)
  assert.match(page, /loss of data/i)
  assert.match(page, /security incident/i)
  assert.match(page, /secrets/i)
  assert.match(page, /terminal/i)
  assert.match(page, /scheduled tasks/i)
  assert.match(page, /paid/i)
  assert.match(page, /United States/i)
  assert.match(page, /merchantability/i)
  assert.match(page, /fitness for a particular purpose/i)
  assert.match(page, /Some jurisdictions do not allow/i)
  assert.match(page, /Nothing in this notice excludes or limits liability/i)
})

test('sidebar footer links to the legal notice', () => {
  const sidebar = readFileSync(new URL('../components/shared/sidebar.tsx', import.meta.url), 'utf8')

  assert.match(sidebar, /href="\/legal-notice"/)
  assert.match(sidebar, /Legal notice/)
})
