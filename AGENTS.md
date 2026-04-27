# Agent Instructions

## Testing

The web E2E test harness is documented in
`apps/docs/docs/development/testing.md`. Treat that document as the source of
truth for how the harness starts the in-memory Postgres/TimescaleDB container,
runs migrations, seeds baseline data, authenticates users, and isolates tests.
Do not duplicate those setup details here.

Rules for using the harness:

- When a feature reads from or writes to the database, use the existing
  database-backed harness. Do not replace database behavior with mocks when the
  behavior under test depends on SQL, migrations, constraints, auth/session rows,
  organisation scoping, cascading deletes, or persisted state.
- When a test needs records beyond the documented baseline seed data, seed those
  records explicitly through the existing fixture/helper pattern. Do not rely on
  state leaked from another test.
- Keep seed data minimal and relevant to the behavior under test. Prefer
  deterministic values and create the relationships the production code expects,
  especially `organisation_id` and ownership/scoping fields.
- Add stable `data-testid` attributes for E2E interactions and assertions rather
  than selecting by generated classes or layout-dependent selectors.

## Pull Requests

All pull request titles must use Conventional Commit format because squash merges
use the PR title as the release-please input.

Use this format:

```text
<type>(<scope>): <summary>
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, and `test`. The scope is optional, but preferred
when the affected package or area is clear.

Examples:

```text
feat(web): add GitLab air-gap bundler
fix(web): repair customer installer bundle
ci(release): add Docker image smoke test
docs(install): document custom HTTPS ports
```

Do not open PRs with non-conventional titles such as `[codex] add feature`.

## Progress Tracking

When a new feature is created that satisfies part or all of an existing
requirement, update the repo-root `PROGRESS.md` as part of the same change. If
the feature fully satisfies the requirement, state that clearly. If it only
satisfies part of the requirement, record exactly which part is complete and
what remains outstanding.

## Completion Cleanup

When work is complete, clean up any temporary worktrees created for the task.
Only remove a worktree after its changes are committed, pushed, released, and
published as appropriate for the task, including publication of new container
images or other release artifacts where relevant. Never delete a worktree that
contains uncommitted user work or unreleased changes.
