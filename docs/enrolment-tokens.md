# Enrolment Tokens

Enrolment tokens are how you control which agents are allowed to register with your organisation. An agent must present a valid token when it first connects — without one, the ingest service rejects the registration.

---

## Overview

Think of enrolment tokens like invite links. You create a token in the UI, put it in the agent's config file, and the agent uses it to introduce itself to the server.

After registration, the token is no longer used — the agent authenticates subsequent connections with the JWT it received at approval.

---

## Creating a token

1. Go to **Settings → Agent Enrolment** in the sidebar
2. Click **New Token**
3. Fill in the form:

| Field | Required | Description |
|---|---|---|
| **Label** | Yes | A name to help you remember what this token is for (e.g. `production-servers`, `dev-vm`) |
| **Auto-approve agents** | No | If ticked, agents registering with this token are automatically approved — no manual review needed |
| **Max uses** | No | Limit how many agents can register with this token. Leave blank for unlimited. |
| **Expires in days** | No | The token stops working after this many days. Leave blank for no expiry. |

4. Click **Create Token**
5. **Copy the token immediately** — only the first 8 and last 4 characters are shown after this dialog closes

---

## Token strategies

**One token per environment**
Create separate tokens for `dev`, `staging`, and `production`. This lets you use different settings (e.g. auto-approve only in dev) and revoke a whole environment's onboarding if needed.

**One token per team**
Give each team their own token with a max-use limit matching the number of hosts they manage.

**Single-use tokens**
Set `Max uses: 1` for registering a specific known host. Once used, the token is exhausted and can't be reused.

**Auto-approve for trusted environments**
Use auto-approve for infrastructure you already control (VMs you provisioned, containers you built). Use manual approval for agents connecting from unknown or externally-managed hosts.

---

## Token lifecycle

A token can be in one of four states:

| Status | Meaning |
|---|---|
| **Active** | Token is valid and can be used by agents |
| **Expired** | The expiry date has passed — no new agents can register with it |
| **Exhausted** | Max uses reached — no new agents can register with it |
| **Revoked** | Manually revoked — no new agents can register with it |

Expired and exhausted tokens are shown in the table for audit purposes. Only **Active** tokens can be revoked — expired and exhausted ones are already inert.

---

## Revoking a token

Click **Revoke** next to an active token. This immediately prevents any new agents from registering with it. **Agents that already registered are not affected** — they authenticate with their JWT, not the enrolment token.

If you need to block a specific agent (not just stop new registrations), reject it from the **Hosts** page while it's in pending state, or contact the CT-Ops admin to revoke the agent's DB entry directly.

---

## Auto-approve

When a token has auto-approve enabled:

1. Agent registers → ingest service validates the token
2. Agent is immediately set to `active` status
3. A JWT is issued and returned in the `RegisterResponse`
4. Agent starts heartbeating — no admin action required

Without auto-approve, the agent waits in `pending` state. An admin must click **Approve** on the Hosts page before the agent can send heartbeats.

**Recommendation:** use auto-approve during initial rollout and for trusted infrastructure. Disable it (or require manual approval) for production agents on sensitive hosts.

---

## Security notes

- Enrolment tokens only control **who can register**. Once registered, the agent uses a JWT for all communication — the token plays no further role.
- A token grants access to your entire organisation. Treat tokens with the same care as API keys — don't commit them to source control or share them in chat.
- Set an expiry date on tokens you hand to third parties or contractors.
- Use `Max uses: 1` for registering a single known host when you want to prevent the token being reused.
- All token activity is logged — the usage count on the token table increments for each registration.
