# Agent Instructions

## Required Agent Workflow

For every task that changes files, agents must complete this checklist unless
the user explicitly says not to:

1. Create a dedicated Git worktree before editing files.
2. Make all edits inside that worktree.
3. Run relevant validation.
4. Commit the changes with a Conventional Commit message.
5. Push the branch to GitHub.
6. Open a pull request with a Conventional Commit title.

Do not stop after local edits. A file-changing task is not complete until the
pull request exists, unless the user explicitly asked for local-only changes.

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

## Pull Requests

After finishing a task, commit the work, push it to GitHub, and create a pull
request unless the user explicitly asks not to. Always use Conventional Commit
names for commits and pull request titles so release-please can function
correctly.

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
