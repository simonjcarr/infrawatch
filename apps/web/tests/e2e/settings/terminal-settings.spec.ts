import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('admin can update organisation terminal settings from settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const terminalEnabledToggle = page.getByTestId('settings-terminal-enabled-toggle')
  const terminalLoggingToggle = page.getByTestId('settings-terminal-logging-toggle')
  const saveButton = page.getByTestId('settings-terminal-save')

  await expect(terminalLoggingToggle).toBeVisible()

  await terminalEnabledToggle.click()
  await expect(terminalLoggingToggle).toBeHidden()
  await saveButton.click()
  await expect(page.getByTestId('settings-terminal-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: { terminalEnabled?: boolean; terminalLoggingEnabled?: boolean } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return {
        terminalEnabled: rows[0]?.metadata?.terminalEnabled,
        terminalLoggingEnabled: rows[0]?.metadata?.terminalLoggingEnabled,
      }
    })
    .toEqual({
      terminalEnabled: false,
      terminalLoggingEnabled: false,
    })

  await terminalEnabledToggle.click()
  await expect(terminalLoggingToggle).toBeVisible()
  await terminalLoggingToggle.click()
  await saveButton.click()
  await expect(page.getByTestId('settings-terminal-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: { terminalEnabled?: boolean; terminalLoggingEnabled?: boolean } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return {
        terminalEnabled: rows[0]?.metadata?.terminalEnabled,
        terminalLoggingEnabled: rows[0]?.metadata?.terminalLoggingEnabled,
      }
    })
    .toEqual({
      terminalEnabled: true,
      terminalLoggingEnabled: true,
    })
})
