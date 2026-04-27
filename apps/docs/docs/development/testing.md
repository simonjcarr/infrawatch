# End-to-end testing

CT-Ops's web application is covered by a Playwright E2E suite that runs against a real Next.js dev server and a real TimescaleDB instance. The database is started on-demand inside a Docker container with its data directory mounted as `tmpfs`, so every test run starts from an empty, in-memory database — no local Postgres needed and no state bleeds between runs.

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
pnpm --filter web test:e2e:no-email-verification
pnpm --filter web test:e2e -- tests/e2e/auth/login.spec.ts
```

The default E2E run leaves `REQUIRE_EMAIL_VERIFICATION` unset, so it exercises the safe default (`true`). `test:e2e:no-email-verification` runs the auth registration spec with `REQUIRE_EMAIL_VERIFICATION=false` to verify unverified local users can sign up, sign in, and continue without the email verification gate.

### Requirements

- Docker Desktop (or any Docker-compatible runtime) running locally.
- Port `3100` free (override with `E2E_PORT=3200 pnpm --filter web test:e2e`).
- Chromium installed once via `pnpm --filter web exec playwright install --with-deps chromium`.

## How the harness is wired

The orchestration lives in `apps/web/tests/e2e/runner.mjs`. It starts the container and runs migrations *before* invoking `playwright test`, because Playwright's own `globalSetup` runs concurrently with the webServer — too late to inject `DATABASE_URL` for a Next.js process that reads it at module init.

The runner is responsible for creating the in-memory database. It starts a `timescale/timescaledb:latest-pg16` Testcontainers container with:

- `POSTGRES_USER=test`
- `POSTGRES_PASSWORD=test`
- `POSTGRES_DB=ctops_test`
- `/var/lib/postgresql/data` mounted as `tmpfs`

After the container is ready, the runner builds a mapped `postgres://test:test@<host>:<port>/ctops_test` URL, assigns it to `process.env.DATABASE_URL`, sets the Better Auth E2E environment variables, runs Drizzle migrations, then starts Playwright. Tests and fixtures should consume `DATABASE_URL` through the existing helpers; they should not start their own database container.

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

## Database access in tests

Use `getTestDb()` from `tests/e2e/fixtures/db.ts` when a test needs to create or inspect database state directly. It returns a `postgres` client connected to the in-memory database created by the runner.

```ts
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('shows seeded hosts', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    INSERT INTO hosts (id, organisation_id, hostname, status)
    VALUES (
      'test-host-1',
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      'web-01',
      'online'
    )
  `

  await page.goto('/hosts')
  await expect(page.getByText('web-01')).toBeVisible()
})
```

Use direct SQL seeding when the setup is only test data and does not need to verify a UI or HTTP workflow. Use the product UI or an API request when the creation path itself is part of the behavior under test, or when production code must perform side effects such as password hashing, session creation, token generation, or validation.

The baseline seed is `seedOrgAndUser()` in `tests/e2e/fixtures/seed.ts`. It is intentionally idempotent: it signs up `e2e@example.com` through Better Auth so the password and account rows are correct, creates the `e2e-test-org` organisation if needed, promotes the user to admin, and deletes the sign-up session so login tests start cleanly.

When adding feature-specific seed helpers:

1. Put shared helpers near the E2E feature or in `tests/e2e/fixtures/` if they will be reused.
2. Keep seed data minimal and deterministic.
3. Always create required relationships explicitly, especially `organisation_id`, ownership fields, and foreign keys.
4. Prefer IDs and names that make assertions readable.
5. Avoid relying on records created by another spec; each spec should seed what it needs.

## Isolation and cleanup

Every spec that imports `test` from `tests/e2e/fixtures/test.ts` gets the auto-running `autoTruncate` fixture. That fixture truncates application tables before each test and deletes sessions, while preserving Better Auth/account rows and the baseline organisation/user created by the setup project.

When a migration adds a new application table, update the `APP_TABLES` list in `tests/e2e/fixtures/db.ts` if that table can receive data during E2E tests. Otherwise, state can leak between tests and make failures order-dependent. Do not add Better Auth identity tables such as `user` or `account` to the truncate list unless the baseline seeding strategy is changed at the same time.

If a test creates data in tables outside `APP_TABLES`, it must clean that data itself or extend the shared truncate list as part of the same change.

## Writing a new test

1. Add stable `data-testid` attributes to the interactive elements you need: inputs, buttons, and the landmark you assert arrival on. Use a consistent prefix per feature (e.g. `hosts-search`, `hosts-create-submit`).
2. Create a spec under `apps/web/tests/e2e/<feature>/<name>.spec.ts` importing from `../fixtures/test`.
3. Use `page.getByTestId(...)` rather than CSS selectors — shadcn/Radix class names are unstable.
4. Prefer `authenticatedPage` unless the test is specifically about unauthenticated flows.
5. Seed database records that are relevant to the behavior under test, rather than mocking database access or depending on incidental state.

For authenticated, database-backed tests, use this shape:

```ts
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('feature behavior', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    INSERT INTO example_table (id, organisation_id, name)
    VALUES (
      'example-1',
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      'Example'
    )
  `

  await page.goto('/example')
  await expect(page.getByTestId('example-heading')).toBeVisible()
})
```

For unauthenticated or auth-specific tests, use the normal `page` fixture instead of `authenticatedPage`, as shown in `tests/e2e/auth/login.spec.ts`.

## Troubleshooting

- If the runner cannot start the database, confirm Docker Desktop or another Docker-compatible runtime is running.
- If Next.js cannot bind to port `3100`, rerun with `E2E_PORT=3200 pnpm --filter web test:e2e`.
- If Chromium is missing, run `pnpm --filter web exec playwright install --with-deps chromium`.
- If authentication behaves unexpectedly after changing seed logic, delete `apps/web/tests/e2e/.auth/user.json` and rerun the suite.
- If data appears to leak between tests, check whether the affected table is missing from `APP_TABLES` in `tests/e2e/fixtures/db.ts`.
- If migrations fail, run the same E2E command again after fixing the migration; the tmpfs database is recreated from scratch on each run.

## CI

The same `pnpm --filter web test:e2e` command works on GitHub Actions' `ubuntu-latest` runners — Testcontainers uses the host's Docker daemon directly (no docker-in-docker required). A future workflow under `.github/workflows/` will wire this up and upload `playwright-report/` and `test-results/` as artifacts on failure.
