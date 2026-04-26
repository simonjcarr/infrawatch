# Agent Instructions

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
