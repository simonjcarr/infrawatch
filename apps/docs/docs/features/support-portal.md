# Support Portal

The support portal lets Infrawatch customers raise tickets from the same web app they use to manage their licences. An AI assistant (Claude) drafts the first response, with full access to the Infrawatch source on GitHub so it can answer code- and configuration-specific questions. A member of our team can step in at any point.

---

## Opening a ticket

Sign in to the licence portal and click **Support** in the sidebar, then **New ticket**. Give the ticket a subject and describe your question or problem. The AI assistant is triggered automatically when you submit.

You can reply to a ticket at any time until it is closed. Each new message triggers another AI turn unless:

- a staff member has already replied (the AI steps aside so we don't talk over each other), or
- the global AI switch is disabled, or
- the per-ticket AI pause is on.

---

## What the assistant can do

| Action | Supported? |
|---|---|
| Read files from the public Infrawatch repo | Yes |
| Look up your licence tier, expiry, and feature flags | Yes |
| Cite specific files when answering | Yes |
| Revoke, issue or extend a licence | No — staff only |
| Process a refund or payment change | No — staff only |
| See your payment details or other customers' data | No |

The assistant produces text only. Any action that touches your account is taken by a human team member.

---

## Prompt-injection defence

Customer-written messages are passed to the model inside `<customer_message>` tags with an explicit instruction to treat the contents as untrusted data, not instructions. Every message is also screened by a lightweight classifier (Claude Haiku) before it reaches the main assistant. If the classifier detects a prompt-injection attempt, the ticket is automatically paused and a human picks it up.

We also redact emails, phone numbers, API tokens and licence keys from the copy sent to the model — even though you should never need to paste those in a support ticket.

---

## Global and per-ticket kill switches

Super-admins can:

- **Disable AI globally** from **Admin → Support → Settings**. New messages route straight to the staff inbox and are not sent to Anthropic.
- **Pause AI on a single ticket** using the *Pause AI* button on the admin ticket view.

There is also an environment-level override: setting `SUPPORT_AI_KILL_SWITCH=1` disables AI regardless of the database setting. Use this for operational emergencies where you cannot trust the UI to take effect quickly (e.g. a leaked API key).

---

## Rate limits

Each ticket is capped at 10 AI responses per rolling hour. If a ticket hits the cap it is paused automatically and a staff member is notified.

---

## Admin health banner

When any support ticket needs staff attention, a strip appears at the top of every admin page. It shows:

- the count of tickets currently awaiting a staff reply (`pending_staff` status), linking to the ticket list;
- the count of tickets flagged with an AI error (e.g. the model couldn't reach the GitHub repo) along with clickable pills that go straight to each flagged ticket.

The banner is driven by a server-side read of the tickets table and auto-refreshes every 15 seconds while any flag is active (30 seconds when clean). If the customer would otherwise have seen an "I'm having trouble reaching the codebase" style apology, the system now pauses the ticket and raises the flag instead — the customer just waits for a human reply rather than being told we have technical issues.

---

## Data that leaves your network

When AI triage is enabled, the following data is sent to Anthropic's API on each AI turn:

- The ticket subject.
- Each message on the ticket, with emails, phone numbers, and secrets pre-redacted.
- Your licence tier, expiry and feature flags (pseudonymised — the model sees `org_<orgId>`, not your name or email).
- Files from the Infrawatch GitHub repo requested by the assistant via tools.

The following data **never** leaves your network:

- Payment details or Stripe IDs.
- Your licence signing keys.
- Any other customer's data.

If you run Infrawatch licensing in an air-gapped environment, disable AI triage — the assistant requires outbound HTTPS to the Anthropic API.
