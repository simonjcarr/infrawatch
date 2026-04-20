# Support AI Architecture

The customer support portal lives inside the licence-purchase Next.js app (`apps/licence-purchase/`). The AI triage pipeline is factored into a single module (`lib/support/ai/`) so it can be isolated, audited, and disabled without touching the rest of the app.

---

## Request flow

```
Customer → Next.js page → Server Action → support_ticket / support_message
                                                       │
                                           INSERT enqueues support_ai_job
                                                       │
                              Postgres-polling worker (pnpm support:worker)
                                                       │
                              ┌────────────────────────┴────────────────────────┐
                              │ 1. Check kill switch (env + settings row)        │
                              │ 2. Check per-ticket aiPaused                     │
                              │ 3. Check rolling rate limit (10 / hour)          │
                              │ 4. Haiku moderation pass on the latest message   │
                              │ 5. Sonnet with tools:                            │
                              │      - search_code(query)   # path match         │
                              │      - read_file(path)                           │
                              │      - get_customer_context(orgId)               │
                              │ 6. Insert support_message row (author='ai')      │
                              └──────────────────────────────────────────────────┘

Staff → /admin/support → reply → auto-pauses AI on that ticket
Super-admin → /admin/support/settings → global kill switch
```

Response latency is 10–30 s for a typical turn; this is why the worker is a separate Node process and not a request handler.

---

## Models

| Role | Model | Notes |
|---|---|---|
| Response | `claude-sonnet-4-6` | Override with `SUPPORT_AI_MODEL_ID` |
| Moderation | `claude-haiku-4-5` | Override with `SUPPORT_AI_MODERATION_MODEL_ID` |

The system prompt is marked with `cache_control: ephemeral` so Anthropic's prompt cache amortises the fixed preamble across turns.

---

## Prompt-injection defence

1. **Hard separation** — every customer message is wrapped in `<customer_message>` tags with a preface instructing the model to treat them as untrusted data.
2. **Haiku pre-pass** — the most recent customer message is classified before the Sonnet call. Confidence ≥ 0.8 causes the ticket to be flagged and paused; no Sonnet turn runs.
3. **Text-only output** — Claude cannot emit action directives. All side-effecting buttons (pause, resolve, close, revoke) are staff-only.
4. **Tool allowlist** — only three tools exist: `search_code`, `read_file`, and `get_customer_context`. All are read-only. `search_code` matches against file paths fetched via the git-trees API (cached 1h per worker process), not GitHub's code-search index — this keeps it working on fresh repos, mirrors, and private forks.
5. **Redaction** — the module's `redact.ts` strips emails, phone numbers, JWTs, AWS keys, Stripe keys, GitHub PATs and long base64 blobs before anything reaches the API.
6. **Pseudonymisation** — the model sees `org_<orgId>`, never the raw customer name or email.
7. **Rate limits** — 10 AI responses per ticket per hour via `support_ai_rate`. Hitting the cap pauses the ticket.
8. **Tool-failure containment** — when ≥2 tool calls in a single turn error out and they're ≥50% of that turn's calls, the orchestrator **does not** post an apology reply. Instead it sets `aiPaused=true`, `aiFlagReason="AI tool error (…)"`, flips the ticket to `pending_staff`, and returns an `error` outcome from `runAiTurn`. The customer sees silence rather than a "having trouble" message; the admin health banner picks up the flag within seconds.

---

## Data boundaries

**What Anthropic sees on each AI turn:**

- Ticket subject and messages (redacted + wrapped).
- Licence tier, expiry, and feature flags for the ticket's organisation.
- Whichever repo files the model asks for via tools. This includes everything in the repository, including proprietary source under `apps/web/enterprise/`, because the product team opted in to code-level debugging for enterprise customers. Paths matching `SUPPORT_GITHUB_REPO_BLOCKLIST` (comma-separated glob patterns) are hard-denied in the tool handler before the HTTP call.

**What Anthropic never sees:**

- Payment details or Stripe customer IDs.
- The licence signing private key or the code that uses it.
- Any other customer's tickets, licences, or users.
- Raw customer emails, names, or phone numbers.
- Environment variables or auth tables.

---

## Kill switches

| Switch | Storage | Effect |
|---|---|---|
| `SUPPORT_AI_KILL_SWITCH=1` env | Process env | Disables AI globally, overrides DB |
| `support_settings.aiEnabled` | DB singleton row | Toggled from `/admin/support/settings` |
| `support_tickets.aiPaused` | DB column | Per-ticket; auto-set true when staff replies |

When either global switch is off, new tickets are **not** sent to Anthropic. They land in the staff inbox and wait for a human reply.

---

## Worker

The worker (`pnpm support:worker`, entrypoint `scripts/support-worker.ts`) polls `support_ai_job` every 2 seconds (configurable via `SUPPORT_WORKER_POLL_MS`). It uses `FOR UPDATE SKIP LOCKED` to atomically claim a job, runs `runAiTurn(ticketId)`, and updates the job row. Failed jobs retry up to three times before being marked `failed`.

The worker must be run as a separate container alongside the Next.js app; it is not invoked from within a web request.

---

## Schema summary

| Table | Purpose |
|---|---|
| `support_ticket` | One per conversation. Status, AI pause flag, flag reason. |
| `support_message` | One per message. Author (customer/ai/staff), body, redacted body, AI telemetry. |
| `support_settings` | Singleton. Global AI enable flag. |
| `support_ai_job` | Queue consumed by the worker. |
| `support_ai_rate` | Rolling-hour counters for per-ticket AI response caps. |

---

## Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for any AI call |
| `GITHUB_SUPPORT_READONLY_TOKEN` | Fine-grained PAT, read-only on the repo |
| `SUPPORT_GITHUB_REPO` | e.g. `carrtech-dev/ct-ops` |
| `SUPPORT_GITHUB_REPO_BLOCKLIST` | Comma-separated glob patterns to block from tools |
| `SUPPORT_AI_KILL_SWITCH` | Set to `1` to force-disable AI |
| `SUPPORT_AI_MODEL_ID` | Default `claude-sonnet-4-6` |
| `SUPPORT_AI_MODERATION_MODEL_ID` | Default `claude-haiku-4-5` |
| `SUPPORT_AI_MAX_RESPONSES_PER_HOUR` | Default 10 |
| `SUPPORT_WORKER_POLL_MS` | Default 2000 |

---

## Air-gapped deployments

AI triage requires outbound HTTPS to `api.anthropic.com` and `api.github.com`. If you run Infrawatch licensing in an air-gapped environment, set `SUPPORT_AI_KILL_SWITCH=1` and do not run the worker — tickets will queue up in the staff inbox as usual and can be answered by a human.
