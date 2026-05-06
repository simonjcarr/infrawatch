import { test as base, expect, type Page } from '@playwright/test'
import { truncateAppTables } from './db'
import { getStorageStatePath } from './auth'
import { createPasswordManagerMock, type PasswordManagerMockController } from './password-manager'
import { seedOrgAndUser } from './seed'

type Fixtures = {
  autoTruncate: void
  authenticatedPage: Page
  passwordManagerMock: PasswordManagerMockController
}

export const test = base.extend<Fixtures>({
  autoTruncate: [
    async ({}, use) => {
      await truncateAppTables()
      await seedOrgAndUser()
      await use()
    },
    { auto: true },
  ],

  authenticatedPage: async ({ browser, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL must be configured')
    const storageState = await getStorageStatePath(baseURL)
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    try {
      await use(page)
    } finally {
      await context.close()
    }
  },

  passwordManagerMock: async ({ authenticatedPage }, use) => {
    const mock = await createPasswordManagerMock(authenticatedPage.context())
    await use(mock)
  },
})

export { expect }
