import { test as setup } from '@playwright/test'
import { seedOrgAndUser } from './fixtures/seed'

setup('seed test organisation and user', async ({ request }) => {
  await seedOrgAndUser(request)
})
