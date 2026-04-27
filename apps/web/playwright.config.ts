import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env['E2E_PORT'] ?? 3100)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // Turbopack rejects pnpm's worktree symlink layout in this E2E setup.
    command: `pnpm exec next dev --webpack -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Environment is set by tests/e2e/runner.mjs before Playwright spawns,
    // and webServer inherits process.env automatically.
  },
})
