# Agent Instructions

## Required Agent Workflow

For every task that changes files, agents must complete this checklist unless
the user explicitly says not to:

1. Create a new dedicated Git worktree before editing files. Never reuse an
   existing worktree for new work, even if it appears idle or related.
2. Make all edits inside the new worktree created for the task.
3. Run relevant validation.
4. Commit the changes with a Conventional Commit message.
5. Push the branch to GitHub.
6. Open a pull request with a Conventional Commit title.
7. Monitor the pull request until checks complete and it can merge cleanly.
8. Merge the pull request into `main`.
9. Confirm any required release has completed and any required container image or
   other artifact has been published.
10. Delete the task worktree folder after the work has landed on `main` and all
    required release or publishing steps are complete.

Do not stop after local edits or after opening a pull request. A file-changing
task is not complete until the code is on `main`, required release and
publishing work is complete, and the task worktree folder has been deleted,
unless the user explicitly asked for local-only changes.

If a pull request has errors, failing checks, or merge conflicts, fix the issue
in a new dedicated worktree and open a new pull request. Repeat this cycle until
all required code is merged into `main` and any required release or image
publication is complete.

## Security Expectations

When planning and implementing a feature, ensure the feature would pass an
ethical hacking test. Security is paramount: a feature should work well and
provide a strong user experience, but not at the expense of abuse resistance,
data protection, or defensible backend controls.

Treat client-side controls as UX aids only. Any security rule, authorization
check, quota, limit, validation, or workflow restriction enforced in the
frontend must also be enforced by the backend or trusted infrastructure.

For forms and other user-controlled inputs:

- Add rate limits to forms and endpoints that accept user input or trigger
  meaningful work.
- Bound input fields to sensible values and reject unreasonable payloads. For
  example, if a form allows selecting IP ports to scan, limit the number of
  ports to a sensible maximum instead of allowing an unbounded list.
- Prevent duplicate submission and make backend handlers idempotent where
  double submission could create duplicate work, records, payments, scans, or
  notifications.
- Validate input shape, type, size, encoding, and allowed values on the backend.
- Apply least-privilege authorization checks to every object or action touched
  by the feature.
- Avoid exposing secrets, internal identifiers, stack traces, or sensitive
  operational details to users or logs.
- Consider common web security risks such as injection, cross-site scripting,
  cross-site request forgery, insecure direct object references, server-side
  request forgery, unsafe file handling, weak session handling, and excessive
  resource consumption.

These examples are not exhaustive. Consider the broader security implications of
the feature, its failure modes, and how it could be abused before shipping.

If you identify an error, bug, or security risk that is unrelated to the task
you are working on, create an issue in the GitHub repository before finishing so
the finding is tracked and not forgotten. Keep the issue focused, include enough
evidence to reproduce or assess the risk, and do not expand the current task's
scope unless the user explicitly asks you to fix it.

## Testing Expectations

Use test-driven development for new features and meaningful behavior changes.
Before writing implementation code, write the relevant tests first. Include unit
tests and end-to-end tests where appropriate for the scope and risk of the
change.

Run the new tests before implementation and confirm they fail for the expected
reason. Then implement the code needed to make those tests pass. This helps
confirm the implementation does what was intended and ensures new behavior has
test coverage.

Do not consider implementation work complete, commit it, or open a pull request
while relevant tests are failing. Investigate and fix failures caused by the
change before finishing. If failures are unrelated or cannot be fixed within the
task scope, document the evidence in the PR and clearly call out the residual
risk.

If a test-first workflow is not practical for a specific change, document why in
the PR and describe the alternative validation that was performed.

## E2E Database Harness

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

After finishing the local implementation for a task, commit the work, push it to
GitHub, create a pull request, monitor it, and merge it into `main` unless the
user explicitly asks not to. Always use Conventional Commit names for commits
and pull request titles so release-please can function correctly.

Keep monitoring the pull request until all checks pass and the branch can merge
without conflict. If checks fail, errors appear, or a merge conflict is detected,
fix the issue in a new dedicated worktree and create a replacement pull request.
Do not reuse the failed pull request's worktree for the next attempt.

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

When work is complete, delete the task worktree folder. Every file-changing task
must finish by removing the dedicated worktree that was created for it.

Only remove a worktree after its changes are committed, pushed, merged into
`main`, released, and published as appropriate for the task, including
publication of new container images or other release artifacts where relevant.
Never delete a worktree that contains uncommitted user work or unreleased
changes.
