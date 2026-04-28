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

test('admin can update organisation notification settings from settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const enabledToggle = page.getByTestId('settings-notifications-enabled-toggle')
  const allowOptOutToggle = page.getByTestId('settings-notifications-allow-opt-out-toggle')
  const engineerRole = page.getByTestId('settings-notifications-role-engineer')
  const readOnlyRole = page.getByTestId('settings-notifications-role-read_only')
  const saveButton = page.getByTestId('settings-notifications-save')

  await enabledToggle.click()
  await expect(page.getByTestId('settings-notifications-role-list')).toHaveCount(0)
  await saveButton.click()
  await expect(page.getByTestId('settings-notifications-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: {
          notificationSettings?: {
            inAppEnabled?: boolean
            inAppRoles?: string[]
            allowUserOptOut?: boolean
          }
        } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return rows[0]?.metadata?.notificationSettings ?? null
    })
    .toEqual({
      inAppEnabled: false,
      inAppRoles: ['super_admin', 'org_admin', 'engineer'],
      allowUserOptOut: true,
    })

  await enabledToggle.click()
  await expect(page.getByTestId('settings-notifications-role-list')).toBeVisible()
  await engineerRole.click()
  await readOnlyRole.click()
  await allowOptOutToggle.click()
  await saveButton.click()
  await expect(page.getByTestId('settings-notifications-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: {
          notificationSettings?: {
            inAppEnabled?: boolean
            inAppRoles?: string[]
            allowUserOptOut?: boolean
          }
        } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return rows[0]?.metadata?.notificationSettings ?? null
    })
    .toEqual({
      inAppEnabled: true,
      inAppRoles: ['super_admin', 'org_admin', 'read_only'],
      allowUserOptOut: false,
    })
})
