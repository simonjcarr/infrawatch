# Licence Purchase App — Build Progress

This app is the self-serve purchase surface for Infrawatch Pro and Enterprise
licences. It runs independently of the main `apps/web` application with its own
database, auth, and signing key.

Features live behind cleanly-typed interfaces in `lib/stripe/`, `lib/licence/`
and `lib/email/` — the next implementer only has to replace the stub body, not
rework the call sites.

Related references:
- **Plan file**: `~/.claude/plans/i-want-you-to-flickering-spark.md`
- **Licence JWT payload shape**: `apps/web/lib/licence.ts:26-38`
- **Feature tier matrix**: `apps/web/lib/features.ts`
- **Customer-facing tier docs**: `apps/docs/docs/licensing.md`
- **Dev signing key**: `deploy/scripts/licence-dev-private.pem`

---

## Phase 0 — Scaffolding (DONE in first session)

- [x] Workspace wiring — `apps/licence-purchase/` picked up by `pnpm-workspace.yaml` and Turbo.
- [x] Next.js 16 + TypeScript strict + Tailwind v4 + shadcn config cloned from `apps/web`.
- [x] Dockerfile mirroring the `apps/web` multi-stage build pattern.
- [x] `docker-compose.dev.yml` updated with an independent `licence-purchase-db` Postgres on port 5433.
- [x] `.env.example` populated with every variable needed for Stripe, email and licence signing.
- [x] Drizzle schema — `organisation`, `user`, `session`, `account`, `verification`, `totp_credential`, `contact`, `purchase`, `invoice`, `licence`, `stripe_webhook_event`.
- [x] Better Auth instance (email/password + TOTP) wired at `/api/auth/[...all]`.
- [x] Landing page, pricing page (driven by `lib/tiers.ts`, monthly/annual toggle), register, login, forgot-password.
- [x] Authenticated `/dashboard`, `/licences/[id]`, `/invoices`, `/account` pages.
- [x] Checkout flow: `/checkout/[tier]` collects interval + payment method (flat per-tier pricing, no seat limits), Server Action redirects to Stripe Checkout / hosted invoice / `/checkout/cancelled`.
- [x] Stripe webhook endpoint at `/api/webhooks/stripe` — verifies signature, persists raw event, calls stubbed handler.
- [x] Licence download endpoint at `/api/licences/[id]/download` streams the `.jwt` with ownership check.
- [x] shadcn primitives: button, card, input, label, badge, separator, switch.

---

## Phase 1 — Stripe wiring

- [x] `lib/stripe/create-checkout-session.ts` — card/bacs_debit via `stripe.checkout.sessions.create`, invoice via `stripe.subscriptions.create({ collection_method: 'send_invoice' })`. Customer is pre-created once per org via `ensure-customer.ts`; both flows share the same Stripe customer id.
- [x] `lib/stripe/handle-webhook.ts` — handles `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. Idempotent: route checks `stripeWebhookEvents.processed` before dispatch, and licence issuance skips if a licence already exists for the invoice's period.
- [x] `lib/stripe/customer-portal.ts` — wired and surfaced as a button on `/account` via `lib/actions/billing.ts` + `BillingPortalButton`.
- [x] `issueLicence` wired into `invoice.paid` — calls on first payment and every renewal (new JWT per period).
- [x] `/checkout/[tier]` gates on a saved technical contact — prevents a purchase that would fail at issuance time.
- [x] `/checkout/success` queries the latest licence and shows it inline; falls back to "issuing your licence" UX if the webhook hasn't caught up.
- [x] `/invoices` lists invoices from the local DB (populated by the `invoice.paid|payment_failed` webhook) with links to Stripe's hosted pages + PDFs.
- [ ] **Operator task**: create Stripe products + prices (Pro monthly/annual, Enterprise monthly/annual) and paste the price IDs into `.env.local`.
- [ ] **Operator task**: enable Stripe Tax on the account; validate VAT numbers on checkout (`stripe.tax.registrations.list`, `stripe.customers.update({ tax: { ... } })`).
- [ ] **Operator task**: register webhook endpoint with Stripe (test + prod) and rotate `STRIPE_WEBHOOK_SECRET` into secret store. Events to forward: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

## Phase 2 — Licence issuance

- [x] Replace `lib/licence/sign.ts` stub with real RS256 signer — loads PEM from `env.licenceSigningPem` (takes precedence) or `env.licenceSigningPath`, signs with `jose.SignJWT`. Payload matches `apps/web/lib/licence.ts` exactly (`iss`, `aud`, `sub`, `tier`, `features`, `customer`, `maxHosts?`, `jti`, `iat`, `nbf`, `exp`).
- [x] Issuer function at `lib/licence/issue.ts` — generates fresh `jti` (cuid2), resolves features via `featureKeysForTier`, calls `signLicence`, persists a `licence` row, and sends the "licence ready" email to the technical contact. Throws cleanly if the org has no technical contact.
- [x] Renewal strategy decided: **new JWT per period**. Every call to `issueLicence` mints a new row with a new jti; natural expiry deprecates the old one, which works for air-gapped installs.
- [ ] Wire `issueLicence` into the `invoice.paid` webhook handler (first payment) and into a scheduled renewal job (every paid period). Deferred to Phase 1 alongside the rest of the Stripe webhook handler.
- [ ] Document production signing-key custody (AWS KMS / HashiCorp Vault Transit / HSM). The dev PEM at `deploy/scripts/licence-dev-private.pem` is for local only.

## Phase 3 — Account UX

- [ ] Wire `/account` contact forms to actually persist — server action is ready, add success toast.
- [ ] Add company detail editing (`organisations` columns) with VAT-number validation.
- [x] `/invoices` populated from the local DB (webhook-driven). If a richer live view is needed, swap to `stripe.invoices.list({ customer })`.
- [ ] Populate dashboard with real `purchase` + `licence` joins (right now it only reads licences).
- [ ] Enforce Better Auth email verification + require TOTP MFA on first login after purchase.
- [ ] Password reset flow (placeholder page currently tells users to email support).

## Phase 4 — Emails

All templates exist as stubs in `lib/email/templates/`. Each needs an HTML + text version and localisation of dates/amounts.

- [ ] `licence-ready.ts` — sent to technical contact after issuance.
- [ ] `receipt.ts` — sent to billing contact on `invoice.paid`.
- [ ] `payment-failed.ts` — sent to billing contact + ops on `invoice.payment_failed`.
- [ ] `renewal-reminder.ts` — sent to procurement at T-30, T-7, T-1 days.
- [ ] `licence-expired.ts` — sent once when licence falls to Community.
- [ ] Internal ops alert to `OPS_NOTIFICATION_EMAIL` on new purchase + payment failures.
- [ ] Ensure all outbound email honours the `SMTP_FROM_*` env vars and the reply-to is `SUPPORT_EMAIL`.

## Phase 5 — Compliance & polish

- [ ] Terms of service + privacy policy — either host `/legal/terms` and `/legal/privacy` pages or link to the marketing site via `TERMS_URL` / `PRIVACY_URL`.
- [ ] Cookie consent banner (required for EU visitors).
- [ ] Rate limiting on auth endpoints (Better Auth has `rateLimit` plugin).
- [ ] Audit log table for purchase + account-management events (feeds into SOC 2 evidence).
- [ ] Accessibility audit against WCAG 2.1 AA — run `@axe-core/cli` in CI.
- [ ] Copy review: every microcopy string read by an engineer, a procurement manager, and a security reviewer.
- [ ] i18n: at minimum EN + DE/FR if selling to EU. Deferred until non-UK customers ask.

## Phase 6 — Deployment

- [ ] Prod `Dockerfile` hardening — currently the runner does not have `su-exec` or an entrypoint shim. Add if we need to fix volume ownership at runtime.
- [ ] Add a `deploy/docker-compose.licence-purchase.yml` prod profile with TLS termination.
- [ ] Optional Helm chart under `deploy/helm/licence-purchase/`.
- [ ] CI workflow: lint + type-check + build on PR (GitHub Actions). See `apps/web` GHA config as template.
- [ ] Stripe webhook endpoint URL registered against production, behind a stable DNS name.
- [ ] Secret management: decide on AWS SSM / SOPS / 1Password CLI — do not bake secrets into images.

## Phase 7 — Open questions to resolve

- [ ] **Pricing amounts** — the numbers in `lib/tiers.ts` are placeholders. Confirm final monthly / annual figures and annual-discount percentage.
- [x] **Seat model decided**: flat per-tier pricing, unlimited hosts/users at every tier. Customers pay for features (SSO, audit log, compliance packs), not scale. `licence.maxHosts` and `purchase.seatCount` have been dropped from the schema.
- [ ] **Renewal JWT strategy** — new JWT per period vs. mutate `exp` on existing. Recommendation: new JWT, so revocation-by-expiry still works for air-gapped installs.
- [ ] **BACS mandate UX** — Stripe `bacs_debit` requires a 3-business-day settlement before the first charge confirms. Policy: issue the licence immediately on subscription activation, or wait for first payment? Current plan: issue on first `invoice.paid` regardless of method.
- [ ] **Refund policy** — define before the first real customer.
- [ ] **VAT invoice layout** — UK and EU B2B customers often need a specific invoice layout. Audit Stripe's default.
- [ ] **Cross-sell from `apps/web`** — a prompt inside the Community UI ("Upgrade to Pro") that deep-links here. Coordinate with the web team once pricing is finalised.

---

## Running locally

```bash
# From repo root
pnpm install
docker compose -f docker-compose.dev.yml up licence-purchase-db -d

cd apps/licence-purchase
cp .env.example .env.local   # fill in BETTER_AUTH_SECRET at minimum
pnpm run db:generate         # on first run (produces lib/db/migrations/)
pnpm run db:migrate
pnpm run dev                 # http://localhost:3001
```

The scaffold runs without Stripe / SMTP credentials — the checkout flow lands on a stub success page and the download endpoint returns `FAKE_JWT_FOR_SCAFFOLDING`. Fill in real keys as you move through Phase 1 and beyond.
