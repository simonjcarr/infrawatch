# Notes

Engineers often keep private notes about the servers they manage — quirks, fix recipes, contacts, workarounds. Notes promote that knowledge into shared team context that survives when someone is off-shift or leaves.

## What a note is

A note has a **title**, a **markdown body**, and a **category**. Categories carry a starter template when you choose them in the editor:

- **general** — free-form
- **runbook** — step-by-step recovery procedure
- **known-issue** — symptom / root cause / workaround / permanent fix
- **fix** — a recipe that resolved a specific problem
- **contact** — owner / team / escalation path
- **workaround** — short-term mitigation with its limitations

Notes are **shared by default** with anyone who can see the host. An author can flip a note to **private** — only the author and super admins can read private notes. Only the author can change the privacy flag; admins cannot hide or expose someone else's note.

## Attaching a note to hosts

A note is not bound to a single host. It targets any combination of:

- **Specific hosts** — one or many
- **A host group** — the note applies to every host in that group
- **A tag selector** — every host that matches a set of `key:value` tags, in either `all` (every tag must be present) or `any` (at least one) mode

The resolver picks up notes from all three modes when viewing a host's Notes tab.

## Pinning

Any direct host or host-group target can be **pinned**. Pinned notes surface on the host's Overview tab as a "Pinned notes" card so on-call engineers see them before digging into metrics.

Tag-selector targets **cannot be pinned** — otherwise a single runbook pinned to `env:prod` would clutter every production host's Overview card. Up to five pins per host.

## Markdown, safely

Bodies are rendered with GitHub-flavored Markdown. Raw HTML in the body is stripped — pasting a `<script>` tag renders it as text, not as markup. Code blocks, tables, task lists, and links work as expected.

## Revisions

Every meaningful change (title, body, or category) writes a row to an immutable revision log. Edits by the same author within a 60-second window collapse into the previous snapshot so keystroke autosaves do not bloat the audit trail; a different author always creates a new snapshot.

The revisions panel on a note shows the last fifty entries.

## Reactions

Readers can mark a note **helpful** or **outdated**. A user can only cast each reaction once per note. Reactions are lightweight trust signals — they do not change a note's visibility or ordering automatically.

## Discovery

Three entry points:

1. **Per-host Notes tab** — everything that resolves to this host
2. **Global `/notes` page** — org-wide list with full-text search (`websearch_to_tsquery` over title + body, title weighted higher) and category / author / "mine only" filters
3. **Cmd+K palette** — type `/notes` or a note title to jump straight to it

## Permissions

| Action | Who |
|---|---|
| Read shared note | Anyone in the org |
| Read private note | Author + super admin |
| Create note | Any role except `read_only` |
| Edit note | Author + org admin + super admin |
| Delete note (soft) | Author + org admin + super admin |
| Toggle private | Author only |

Deletion is soft — the note row is marked `deletedAt` and disappears from every list, but the revision history remains.

## Data model

Four tables (all in `apps/web/lib/db/schema/notes.ts`):

- `notes` — content and ownership, with a generated `tsvector` column and GIN index for full-text search
- `note_targets` — polymorphic scope (`host` / `host_group` / `tag_selector`), pin flag per target
- `note_revisions` — append-only edit history
- `note_reactions` — one user × note × reaction triple, uniquely indexed

Tags on a note reuse the existing `resource_tags` join table (`resourceType = 'note'`).
