# End-to-end testing

Infrawatch's web application is covered by a Playwright E2E suite that runs against a real Next.js dev server and a real TimescaleDB instance. The database is started on-demand inside a Docker container with its data directory mounted as `tmpfs`, so every test run starts from an empty, in-memory database — no local Postgres needed and no state bleeds between runs.

## Running the tests

From the repo root:

```bash
pnpm --filter web test:e2e
```

That single command will:

1. Start a `timescale/timescaledb:latest-pg16` container via Testcontainers (tmpfs-backed).
2. Run all Drizzle migrations against the container.
3. Launch Next.js dev on port `3100` (configurable via `E2E_PORT`).
4. Run a setup project that seeds an organisation and an admin user (`e2e@example.com` / `TestPassword123!`).
5. Run the chromium test project.
6. Stop the container on exit.

Useful variants:

```bash
pnpm --filter web test:e2e:ui        # Playwright UI mode
pnpm --filter web test:e2e:report    # Open the last HTML report
```

### Requirements

- Docker Desktop (or any Docker-compatible runtime) running locally.
- Port `3100` free (override with `E2E_PORT=3200 pnpm --filter web test:e2e`).
- Chromium installed once via `pnpm --filter web exec playwright install --with-deps chromium`.

## How the harness is wired

The orchestration lives in `apps/web/tests/e2e/runner.mjs`. It starts the container and runs migrations *before* invoking `playwright test`, because Playwright's own `globalSetup` runs concurrently with the webServer — too late to inject `DATABASE_URL` for a Next.js process that reads it at module init.

Once Playwright is running, seeding happens as a dedicated setup project (`auth.setup.ts`). The `chromium` project declares it as a dependency, so the seed runs before any spec.

Per-test isolation is provided by an auto-running `autoTruncate` fixture that runs `TRUNCATE ... RESTART IDENTITY CASCADE` on every app table between tests and deletes all sessions. Seed rows (organisations, user, account) are preserved. Tests run serially with a single worker; moving to parallel workers would require one Next.js process per worker on distinct ports.

## Authentication in tests

The canonical pattern is the `authenticatedPage` fixture exported from `tests/e2e/fixtures/test.ts`. It programmatically signs in once per worker by POSTing to Better Auth's `/api/auth/sign-in/email`, captures the cookie via Playwright's `storageState`, and hands back a pre-authenticated page.

```ts
import { test, expect } from '../fixtures/test'

test('authenticated user can list hosts', async ({ authenticatedPage: page }) => {
  await page.goto('/hosts')
  await expect(page.getByTestId('hosts-heading')).toBeVisible()
})
```

Never drive the login form from tests that aren't specifically testing login — use `authenticatedPage`. Login form coverage lives in `tests/e2e/auth/login.spec.ts`, which uses the default `page` fixture to exercise the real sign-in flow end-to-end.

## Writing a new test

1. Add stable `data-testid` attributes to the interactive elements you need: inputs, buttons, and the landmark you assert arrival on. Use a consistent prefix per feature (e.g. `hosts-search`, `hosts-create-submit`).
2. Create a spec under `apps/web/tests/e2e/<feature>/<name>.spec.ts` importing from `../fixtures/test`.
3. Use `page.getByTestId(...)` rather than CSS selectors — shadcn/Radix class names are unstable.
4. Prefer `authenticatedPage` unless the test is specifically about unauthenticated flows.

## CI

The same `pnpm --filter web test:e2e` command works on GitHub Actions' `ubuntu-latest` runners — Testcontainers uses the host's Docker daemon directly (no docker-in-docker required). A future workflow under `.github/workflows/` will wire this up and upload `playwright-report/` and `test-results/` as artifacts on failure.
