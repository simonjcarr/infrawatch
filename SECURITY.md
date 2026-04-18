# SECURITY.md — Pre-Pentest Findings

Findings from an internal, pre-pentest code audit of the Infrawatch codebase. Each item is logged as a TODO for later triage, prioritisation and remediation. **Nothing in this file has been fixed.**

Scope covered:
- Authentication, session, identity, RBAC, licence
- Next.js HTTP API routes (`apps/web/app/api/*`)
- Server actions (`apps/web/lib/actions/*`)
- Go agent (`agent/`), gRPC ingest (`apps/ingest/`), consumers
- Database schema and query patterns (`apps/web/lib/db/`)
- Cryptography / secrets (`apps/web/lib/crypto/`, `apps/web/lib/licence.ts`)
- Deployment (Dockerfile, entrypoint, docker-compose, install.sh, start.sh, `next.config.ts`)

Severity key: **C**ritical / **H**igh / **M**edium / **L**ow / **I**nfo.

> Note: Findings were generated via static code review. Line numbers are approximate — verify by opening the file before remediation. Each claim should be confirmed during triage; some items may be false positives once runtime behaviour and middleware are considered.

---

## CRITICAL

- [ ] **[C-01] LDAP login can silently merge to an account in ANY organisation (cross-org takeover)**
  - Location: `apps/web/app/api/auth/ldap/route.ts:~67-75`
  - On LDAP bind success, the handler finds an existing user by email with no `organisationId` filter, then links the LDAP account to whatever user row it finds. An attacker operating in Org A with control of an LDAP entry using a victim's email can hijack the Org B account when the LDAP user next authenticates.
  - Fix direction: scope `findFirst` for `users` by both `email` and the configured org id (`eq(users.organisationId, config.organisationId)`). Never link across organisations.

- [ ] **[C-02] User management server actions trust a client-supplied `requesterId`/`invitedById` without role verification**
  - Location: `apps/web/lib/actions/users.ts` — `inviteUser` (~37), `updateUserRole` (~?), `deactivateUser`, `removeUser`
  - The functions take the acting-user id as a parameter but never look it up to verify `role in ('org_admin', 'super_admin')`. Any authenticated user can call the action directly (e.g., via the Next.js server-action RPC endpoint) and escalate, demote, or deactivate others.
  - Fix direction: replace parameter-supplied requester ids with `await auth.api.getSession()` and enforce role at the start of every privileged action.

- [ ] **[C-03] Email verification disabled by default in Better Auth**
  - Location: `apps/web/lib/auth/index.ts:~19` (`requireEmailVerification: false`)
  - Anyone can register under any email (including executives of a target org), enabling phishing setup, squatting, and spoofed audit trails.
  - Fix direction: require email verification; ship a verification-email flow before GA.

- [ ] **[C-04] LDAP filter injection via unescaped `{{username}}` substitution**
  - Location: `apps/web/lib/ldap/client.ts:~307`, `apps/web/lib/actions/ldap.ts:~254`
  - `searchFilter = config.userSearchFilter.replace('{{username}}', username)` does not escape LDAP metacharacters (`*`, `(`, `)`, `\`, NUL) per RFC 4515. Attacker-crafted usernames (e.g. `*))(|(uid=*`) alter filter semantics, potentially bypassing auth or enumerating directory data.
  - Fix direction: apply RFC 4515 escaping (or `ldapts` built-in escape) before substitution.

- [ ] **[C-05] gRPC heartbeat handler falls back to client-supplied `AgentId` when JWT validation fails**
  - Location: `apps/ingest/internal/handlers/heartbeat.go:~65-74`
  - When `ValidateAgentToken` errors, the code sets `agentID = first.AgentId` and continues. Anyone who knows a target agent id can heartbeat as that agent and push/read its data.
  - Fix direction: remove the fallback. Return `codes.Unauthenticated` on any JWT validation failure. Handle legacy clients via explicit version negotiation, not silent bypass.

- [ ] **[C-06] Unauthenticated SSRF in certificate-checker tool**
  - Location: `apps/web/app/api/tools/certificate-checker/route.ts:~81-84` (POST, `action = fetch-url`)
  - Endpoint has no session check and accepts arbitrary host+port, allowing unauthenticated callers to probe cloud metadata (`169.254.169.254`), internal Kubernetes API, DBs, etc. Also no private-IP blocklist even once auth is added.
  - Fix direction: require authentication; add IP-range denylist (127.0.0.0/8, 10.0.0.0/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7); restrict allowable ports.

- [ ] **[C-07] Webhook/notification test-send is SSRF-capable (authenticated)**
  - Location: `apps/web/lib/actions/alerts.ts:~673-720` (`sendTestNotification` and channel creation)
  - Webhook/Slack/Telegram/SMTP fields accept arbitrary URLs/hostnames. `sendTestNotification` reaches them server-side with no SSRF guard, enabling internal-network probing and abuse from any authenticated account.
  - Fix direction: resolve target host and reject private/reserved IPs; force HTTPS for web hooks; cap size/timeout; rate-limit per org/user.

- [ ] **[C-08] Missing authentication on *most* server-action read paths**
  - Location: `apps/web/lib/actions/*.ts` — broad pattern. Examples include `agents.ts` (`listPendingAgents`, `listHosts`, `getHost`, `getHostMetrics`, ...), `alerts.ts` (`getAlertRules`, `getNotificationChannels`, ...), `certificates.ts` (`getCertificates`, `getCertificate`, `getCertificateCounts`, `deleteCertificate`), `checks.ts`, `domain-accounts.ts`, `host-groups.ts`, `host-settings.ts`, `notifications.ts`, `service-accounts.ts`, `software-inventory.ts`, `task-runs.ts`.
  - Functions accept `orgId` as an argument and query the DB without verifying the caller is logged in, let alone a member of that org. Any unauthenticated request that can reach the Next.js action RPC endpoint can pull another org's data by guessing/enumerating org ids.
  - Fix direction: add `const session = await getRequiredSession(); if (session.user.organisationId !== orgId) throw ...` to every action. Consider removing `orgId` from public parameters and always deriving it from the session.

- [ ] **[C-09] `deleteCertificate` (and other destructive actions) have no auth/org check**
  - Location: `apps/web/lib/actions/certificates.ts:~118-137`
  - Takes `orgId` + `certId` only. An attacker can delete any certificate in any organisation.
  - Fix direction: session check + confirm the cert belongs to the session's org before deleting; use soft-delete (`deletedAt`) per the universal table convention.

- [ ] **[C-10] Agent self-update executes server-supplied binary with no signature verification**
  - Location: `agent/internal/updater/updater.go:~25-100`
  - Agent downloads and `exec`s a binary from a server URL without signature/hash verification. A compromised or MITM'd server pushes arbitrary code to every host as root.
  - Fix direction: sign release binaries; embed a pinned public key in the agent; verify signature + expected version before `exec`. Consider TUF or cosign for release flow.

- [ ] **[C-11] Hardcoded development public key used to validate production licence JWTs**
  - Location: `apps/web/lib/licence.ts:~5-13`
  - The dev RSA public key is baked into source. Anyone with the matching dev private key (which very likely exists under `deploy/` or has been shared) can forge `tier=enterprise` JWTs for any org id.
  - Fix direction: load the production public key from an env var (e.g., `LICENCE_PUBLIC_KEY`); fail to boot if missing or equal to the dev key.

- [ ] **[C-12] Raw SQL interpolation in `updateMetricRetention`**
  - Location: `apps/web/lib/actions/settings.ts:~80, ~90`
  - `sql.raw(String(days))` is used inside a dynamically constructed `INTERVAL` literal. Although Zod constrains `days`, `sql.raw` bypasses parameterisation and represents a pattern that can be copied elsewhere less carefully. Any future change to the Zod schema (or a regression) turns this into SQL injection.
  - Fix direction: use Drizzle parameter binding (`sql\`INTERVAL \${days} days\``) and validate with strict integer coercion.

---

## HIGH

- [ ] **[H-01] No rate limiting on authentication endpoints**
  - `apps/web/app/api/auth/[...all]/route.ts` (Better Auth), `apps/web/app/api/auth/ldap/route.ts`
  - No per-IP or per-account throttling, no lockout, no CAPTCHA. Supports online brute-force of passwords, TOTP, invite tokens, LDAP bind creds.
  - Fix: add rate-limiting middleware (e.g. upstash ratelimit, or the queue abstraction) keyed on IP + username; exponential backoff; generic "invalid credentials" response; lockout threshold.

- [ ] **[H-02] No CSRF protection on state-changing server actions or non-auth API routes**
  - Every server action under `apps/web/lib/actions/` and most POST/PUT/DELETE routes under `apps/web/app/api/` lack explicit CSRF tokens and rely solely on cookies for auth. Next.js server actions are subject to CSRF unless `trustedOrigins` is strictly configured.
  - Fix: verify Better Auth `trustedOrigins` is set to a tight allowlist; for API routes, validate `Origin`/`Referer`; or implement the double-submit cookie pattern.

- [ ] **[H-03] LDAP bind password encryption uses a hardcoded, shared salt**
  - Location: `apps/web/lib/crypto/encrypt.ts:~5-10` (`SALT = 'infrawatch-ldap-encryption-salt'`)
  - `scryptSync(secret, SALT, 32)` produces the same key for every ciphertext, every config, every customer. If `BETTER_AUTH_SECRET` leaks once, every stored LDAP password (across all orgs, installations) is decryptable.
  - Fix: random per-record salt persisted alongside ciphertext; separate dedicated encryption secret (not reused from auth).

- [ ] **[H-04] LDAP bind password decryption uses `BETTER_AUTH_SECRET` as KDF input**
  - Location: `apps/web/lib/ldap/client.ts:~55-62`
  - Ties two unrelated trust domains together. Rotating `BETTER_AUTH_SECRET` breaks all stored LDAP passwords silently.
  - Fix: dedicated env var `LDAP_ENCRYPTION_KEY` (or a secrets manager), with rotation tooling.

- [ ] **[H-05] LDAP `tls_certificate` column stored in plaintext**
  - Location: `apps/web/lib/db/schema/ldap-configurations.ts:~15-18`
  - Also `bind_dn` is plaintext and may disclose internal directory structure.
  - Fix: encrypt sensitive LDAP columns at rest with the same mechanism used for `bind_password`.

- [ ] **[H-06] Weak password policy**
  - `apps/web/app/(auth)/register/register-form.tsx:~28`, `apps/web/lib/actions/profile.ts:~134`
  - Minimum 8 chars, no complexity, no common-password check.
  - Fix: raise minimum (≥12), integrate `zxcvbn` or HIBP Pwned Passwords; document NIST-aligned rules.

- [ ] **[H-07] No account lockout / progressive delay after failed logins**
  - Custom LDAP endpoint and Better Auth login are both missing lockout.
  - Fix: track consecutive failures per user + IP; lock account after N failures; notify the user by email.

- [ ] **[H-08] Invitation tokens generated with `createId()` (cuid2), not `randomBytes`**
  - Location: `apps/web/lib/actions/auth.ts:~8-18` + invite issuance.
  - cuid2 is not designed as a security token; lacks the entropy guarantees of a cryptographically random 32-byte secret. No rate limit on invite lookup.
  - Fix: generate tokens via `crypto.randomBytes(32).toString('hex')`; rate-limit `getInviteByToken`; short expiry; hash before storing.

- [ ] **[H-09] Custom session cookie HMAC duplicated in LDAP handler**
  - Location: `apps/web/app/api/auth/ldap/route.ts:~109-125`
  - The handler re-implements cookie signing instead of delegating to Better Auth's signed cookie API. Divergence between the two implementations is a recurring source of session validation bypasses.
  - Fix: remove custom HMAC; call Better Auth's signed-cookie helper (or create the session through Better Auth and redirect).

- [ ] **[H-10] Terminal gRPC handler accepts expired JWTs and falls back to session_id**
  - Location: `apps/ingest/internal/handlers/terminal_grpc.go:~62-66`
  - `ValidateAgentTokenAllowExpired` + `agentID = "unknown"` on error weakens the auth model. Attackers only need to guess/observe a session id.
  - Fix: require valid JWT; use the authenticated agent id to authorise the session, not a client-supplied session id.

- [ ] **[H-11] Hostname/IP re-registration lets an attacker take over an existing host identity**
  - Location: `apps/ingest/internal/handlers/register.go:~40-238`
  - If an attacker knows a valid enrolment token and a target hostname, the collision-detection path can "adopt" the existing registration under a new keypair.
  - Fix: require admin approval for any re-registration of a host with an existing record; alert on keypair change; pin public-key fingerprint on first registration.

- [ ] **[H-12] Enrolment tokens are replay-safe only via usage counter (no hard max_uses/expiry)**
  - Location: `apps/ingest/internal/handlers/register.go:~55-65, ~150-192`
  - A leaked token can be used to register unlimited agents; no enforced expiry or max-uses.
  - Fix: add `max_uses`, `expires_at`; hash tokens at rest; audit-log every registration; rate-limit by source IP.

- [ ] **[H-13] `/api/agent/bundle`, `/api/agent/install`, `/api/agent/download`, `/api/agent/latest` lack rate limiting**
  - Unauthenticated endpoints used for binary download and installer enrolment — trivial to abuse for DoS and recon.
  - Fix: per-IP rate limits, size caps, and audit logging.

- [ ] **[H-14] `node-forge` X.509 parsing on untrusted input**
  - Location: `apps/web/lib/certificates/fetch.ts:~87-89`
  - Parsing attacker-controlled certificates (from remote hosts via `/api/tools/certificate-checker`, from uploads) exposes a historically bug-prone ASN.1 parser. Combined with C-06 this is a direct reachability path.
  - Fix: prefer Node's built-in `crypto.X509Certificate`; keep node-forge pinned and patched; cap certificate size; wrap in a resource-limited worker.

- [ ] **[H-15] `lib/certificates/fetch.ts` has no private-IP / SSRF denylist**
  - `fetchCertPemsFromUrl` connects to any hostname with a 10s timeout. Called from `trackCertificateFromUrl` and from the cert-checker endpoint.
  - Fix: resolve DNS first; reject private ranges and `169.254/16`; allow opt-in for specific internal hostnames only.

- [ ] **[H-16] Secrets leaked in notification channel create/update response**
  - Location: `apps/web/lib/actions/alerts.ts:~517-671`
  - `createNotificationChannel` returns the raw config object (including webhook auth headers, SMTP password, Telegram token) back to the caller. `getNotificationChannels` sanitises, but create/update does not.
  - Fix: always return the sanitised `NotificationChannelSafe` shape.

- [ ] **[H-17] Potential SSH private-key exposure in `getServiceAccount`**
  - Location: `apps/web/lib/actions/service-accounts.ts:~144-150`
  - Function returns `sshKeys` rows directly — need to verify the schema never includes private-key material before returning to the client.
  - Fix: explicitly project only public fields; never return private-key columns from any action.

- [ ] **[H-18] Dockerfile `entrypoint.sh` runs as root before dropping to `nextjs`**
  - Location: `apps/web/Dockerfile:~92-103` + `apps/web/entrypoint.sh`
  - `chown -R nextjs:nodejs /var/lib/infrawatch/agent-dist` runs as root at every boot. If the script or the directory is writable by the `nextjs` user, a privilege-escalation primitive exists.
  - Fix: pre-create directories with correct ownership at build time; drop root entirely; make the volume owned by `nextjs` via `--chown` mount options.

- [ ] **[H-19] Docker images referenced by tag, not digest**
  - Location: `docker-compose.single.yml:~3-4, ~20, ~44`
  - Tag reassignment (compromised GHCR, or supply chain) replaces running code silently. Comment already acknowledges pinning should be done.
  - Fix: pin `image: ...@sha256:...` in every profile used for production; update via CI.

- [ ] **[H-20] `install.sh` is a curl-piped-to-bash installer with no signature/checksum verification**
  - Location: `install.sh:~1-10`
  - Downloads and unpacks a ZIP from GitHub releases with no integrity check. A release compromise (or MITM for anyone without TLS pinning) distributes backdoors to all operators.
  - Fix: publish GPG or cosign signatures; verify SHA256 checksum against a known value; prefer container images.

- [ ] **[H-21] `direct_access = true` terminal mode grants PTY as root with no extra checks**
  - Location: `agent/internal/terminal/session.go:~82-116`
  - Direct-access mode bypasses the per-user `su` drop.
  - Fix: require org_admin + explicit per-host opt-in + audit log; prefer per-user sessions by default; require MFA for direct-access sessions.

- [ ] **[H-22] Task script execution has no sandbox / resource limits**
  - Location: `agent/internal/tasks/script.go:~33-111`
  - Server-supplied script body is written to a temp file and executed as the agent user (typically root) with no cgroup, seccomp, or timeout limit. If the server or server-side authorisation is compromised, this is direct RCE on every host.
  - Fix: execute scripts under an unprivileged user by default; enforce CPU/memory/time limits; log every script to an append-only audit store; require task payload to be signed server-side with a key the agent validates.

- [ ] **[H-23] gRPC ingest server missing `MaxRecvMsgSize`, `MaxSendMsgSize`, `MaxConcurrentStreams`**
  - Location: `apps/ingest/internal/grpc/server.go:~49-100`
  - A malicious or buggy agent can push huge messages or open unlimited streams until the server OOMs.
  - Fix: set conservative caps (e.g. 50 MB message, 1k streams per connection); add keepalive and stream deadlines.

- [ ] **[H-24] Missing composite index on `host_metrics(organisation_id, host_id, recorded_at)`**
  - Location: `apps/web/lib/db/schema/metrics.ts:~6-24`
  - Time-series queries with tenant filters fall back to full table scans on a hypertable that will hold the bulk of all data; any user can degrade the entire cluster by requesting wide time ranges.
  - Fix: add the composite index (or TimescaleDB chunk-aware equivalent); cap the time range allowed in user-facing queries.

- [ ] **[H-25] Invite/password-reset/invitation lookups miss rate limits**
  - `getInviteByToken`, `acceptInvite`, LDAP bind, email/password login.
  - Fix: uniform rate-limiting middleware across auth-adjacent actions.

- [ ] **[H-26] `proxy.ts` and any reverse-proxy behaviour may be abusable for SSRF**
  - Location: `apps/web/proxy.ts` — needs review against the agent/ingest traffic path to ensure it does not forward attacker-controlled URLs to arbitrary internal services.
  - Fix direction: triage during hardening; allowlist target hosts; strip hop-by-hop headers.

- [ ] **[H-27] Missing security headers / CSP**
  - Location: `apps/web/next.config.ts:~1-12`
  - No CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Clickjacking, MIME sniffing, and referrer-based token leakage are all possible.
  - Fix: add `headers()` returning a strict header set; consider middleware for nonces to enable strict CSP.

- [ ] **[H-28] `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` fall back to insecure defaults**
  - Location: `apps/web/lib/auth/index.ts:~30-32`
  - Empty secret + localhost URL are accepted at startup; failures surface only when a crypto operation runs.
  - Fix: fail-fast validation at boot for all required env vars; refuse to start with empty/placeholder values; provide a `./scripts/doctor` command.

- [ ] **[H-29] LIKE searches built with unescaped user input**
  - Files: `apps/web/lib/actions/domain-accounts.ts:~63`, `service-accounts.ts:~66`, `certificates.ts:~53`, `software-inventory.ts:~240, ~312`
  - `%` and `_` wildcards are not escaped. Not a classic SQL-injection but produces unbounded scans (DoS) and bypasses the caller's apparent filter.
  - Fix: reuse `escapeLikePattern` (already present in `software-inventory.ts`) across all modules; add linting.

- [ ] **[H-30] Hard delete for `domain_accounts` breaks the soft-delete invariant**
  - Location: `apps/web/lib/actions/domain-accounts.ts:~213-215`
  - CLAUDE.md states every table uses `deleted_at`. Hard delete silently loses audit history and breaks cascade assumptions (e.g., event spine references).
  - Fix: soft-delete via `deletedAt`; revisit any other `db.delete(...)` occurrences.

- [ ] **[H-31] Default Postgres credentials in `docker-compose.single.yml`**
  - Location: `docker-compose.single.yml:~6-8, ~31` (`infrawatch:infrawatch@db:5432/infrawatch`)
  - Operators who skip editing `.env` will ship with trivially guessable credentials.
  - Fix: require `POSTGRES_PASSWORD` to be set (no default); generate a random password on first run; document the requirement prominently.

---

## MEDIUM

- [ ] **[M-01] User enumeration via differential responses / timing on the LDAP endpoint**
  - `apps/web/app/api/auth/ldap/route.ts:~28-29, ~148` — generic error externally but detailed logs internally; response time may differ.
  - Fix: constant-time comparisons; artificial jitter; identical error strings.

- [ ] **[M-02] Stack traces / raw error strings returned to clients**
  - Examples: `apps/web/app/api/auth/ldap/route.ts:~152`, `apps/web/app/api/tools/certificate-checker/route.ts:~138-141`, many `catch (err) { return { error: err.message } }` in `lib/actions/*`.
  - Fix: centralised error handler; log details server-side; return stable error codes / generic strings.

- [ ] **[M-03] `licence` validation allows unsigned algorithm?**
  - Location: `apps/web/lib/licence.ts`
  - Triage required — confirm the JWT verification call enforces `algorithms: ['RS256']` and rejects `alg=none`.
  - Fix: explicitly allowlist algorithm; assert `typ`, `iss`, `aud`, `exp`, `iat`.

- [ ] **[M-04] Agent config file permissions not verified on load**
  - Location: `agent/internal/install/install.go:~104, ~126, ~190, ~230`; `agent/internal/config/config.go`
  - Written 0600 on install but a later `chmod` or user modification goes undetected.
  - Fix: on boot, `Stat` config files; refuse to start if mode is > 0600 or ownership is non-root.

- [ ] **[M-05] Certificate file checks follow symlinks**
  - Location: `agent/internal/checks/cert_file.go:~96-112`
  - `os.ReadFile` follows symlinks by default; an attacker with local write access to a monitored directory can point the check at arbitrary files to exfiltrate or confuse alerts.
  - Fix: `os.Lstat` and reject symlinks; or use `os.OpenFile` with `O_NOFOLLOW`.

- [ ] **[M-06] Terminal WS session IDs accepted from URL path**
  - Location: `apps/ingest/internal/handlers/terminal_ws.go:~46-53`
  - Needs verification that session ids are cryptographically random (≥128 bits) and single-use.
  - Fix: generate with `crypto/rand`; bind to the authenticated user; expire on disconnect.

- [ ] **[M-07] Terminal username regex is too permissive**
  - Location: `agent/internal/terminal/session.go:~91-94` and `apps/web/lib/actions/terminal.ts:~87-99`
  - `[a-zA-Z0-9._@\-]+` allows `@`, `.` and `-` leading characters that some shells or `su` implementations treat specially.
  - Fix: defer to `user.Lookup`; do not do shell-style interpolation on the username.

- [ ] **[M-08] JSONB metadata columns have no runtime validation**
  - Location: every table with `metadata: jsonb('metadata')` (hosts, alerts, events, etc.)
  - `.$type<T>()` provides compile-time typing only; runtime code may consume unexpected fields, and any code path that evaluates metadata (templating, handlebars, etc.) is a potential code-exec risk.
  - Fix: Zod-parse metadata on read/write boundaries; do not `eval` or template it without sanitisation.

- [ ] **[M-09] No audit log for sensitive mutations**
  - Role changes, user removal, alert-rule deletion, silence creation, host deletion, terminal-settings changes, enrolment-token creation, licence updates, notification-channel modification.
  - Fix: introduce append-only `audit_events` table; write entries from a single helper invoked by every privileged action.

- [ ] **[M-10] Missing rate limiting on expensive actions**
  - `alerts.sendTestNotification`, `software-inventory.triggerSoftwareScan`, `software-inventory.getSoftwareReport`, `certificates.trackCertificateFromUrl`, `agents.createEnrolmentToken`.
  - Fix: per-org token-bucket or leaky-bucket limiter.

- [ ] **[M-11] Cert-file path validation too permissive**
  - Location: `apps/web/lib/actions/checks.ts:~35-40` (`certFileConfigSchema.filePath`)
  - Only `.min(1)`. Allows `/etc/shadow`, `../../etc/passwd`, `/proc/*/mem`. Defence-in-depth; the agent must still restrict, but the server should not accept such paths.
  - Fix: explicit allowlist/regex; reject `..`, absolute paths outside an allowed prefix, and `/proc`, `/sys`, `/dev`.

- [ ] **[M-12] Notification channel configuration (SMTP, webhook) accepts plain HTTP**
  - `apps/web/lib/actions/alerts.ts` — verify URL schema validation, TLS enforcement, and port allowlist.
  - Fix: require HTTPS (unless explicitly overridden per org); restrict SMTP ports and TLS modes.

- [ ] **[M-13] Licence JWT bound only to offline validation; no revocation signal**
  - Location: `apps/web/lib/licence.ts`
  - A leaked/forged licence cannot be revoked. Combined with C-11 this is more urgent.
  - Fix: add revocation list distributed via signed bundle; shorter `exp`; periodic server-side re-validation when online.

- [ ] **[M-14] `$$ECB$$`/`MD5`/`SHA1` usage for security-relevant purposes?**
  - Triage: confirm no uses of MD5 or SHA1 in auth or integrity paths. `fetch.ts` uses SHA1 only for display fingerprints (Low).
  - Fix: explicit deny-list in CI (lint for `createHash('md5'|'sha1')`, `createCipheriv('*-ecb'|'*-cbc'` without HMAC)).

- [ ] **[M-15] Encryption format in `lib/crypto/encrypt.ts` is `:` separated**
  - Location: `apps/web/lib/crypto/encrypt.ts:~23, ~28-33`
  - String splitting is safe today, but packed binary (`iv||tag||ciphertext` base64) is less fragile as the format evolves.
  - Fix: canonical binary layout + length prefixes.

- [ ] **[M-16] Agent heartbeat buffers unbounded task progress / result bytes**
  - Location: `agent/internal/heartbeat/heartbeat.go:~115, ~395-406`
  - Large task output builds up in memory before a heartbeat delivers it.
  - Fix: cap buffered output per task and per interval; truncate with explicit "output truncated" marker; stream large outputs directly to server.

- [ ] **[M-17] `getActiveEnrolmentToken` and `listEnrolmentTokens` return plaintext tokens**
  - Location: `apps/web/lib/actions/agents.ts` — triage whether tokens are stored hashed or in plaintext and what is returned in `GET` responses.
  - Fix: store tokens hashed (argon2id or SHA-256 with random secret), display only once on creation, show hints (last 4 chars) afterwards.

- [ ] **[M-18] `INGEST_WS_URL` returned to the client**
  - Location: `apps/web/lib/actions/terminal.ts:~115`
  - Exposes internal topology; in many deployments the ingest URL should not be browser-reachable.
  - Fix: proxy WS through Next.js or a same-origin hostname; do not emit raw `process.env` to clients.

- [ ] **[M-19] Cert fetch has no response-size limit**
  - Location: `apps/web/lib/certificates/fetch.ts`
  - A malicious server can return arbitrarily large data; parsing a huge "cert" causes memory pressure.
  - Fix: cap read bytes (e.g. 64 KB per cert); enforce TLS handshake timeout separately from read timeout.

- [ ] **[M-20] No request-id / correlation-id on API responses**
  - Hampers forensic tracing during incident response.
  - Fix: middleware injecting `X-Request-Id`; include it in error responses and logs.

- [ ] **[M-21] Host deletion cascade has TOCTOU between existence check and transaction**
  - Location: `apps/web/lib/actions/agents.ts:~634-814`
  - Concurrent requests can race across the cascade.
  - Fix: move the lookup inside the transaction with `for update`; or rely on FK cascades where possible.

- [ ] **[M-22] `createGroup`/`updateGroup` accept untyped `data` without Zod**
  - Location: `apps/web/lib/actions/host-groups.ts:~14-34`
  - Fix: add explicit schemas.

- [ ] **[M-23] CSV export formula-injection mitigation is incomplete**
  - Location: `apps/web/app/api/reports/software/export/route.ts:~44-52`
  - Single-quote prefix is defeated by some spreadsheet programs.
  - Fix: also escape with a tab, document the risk, or export as XLSX/PDF only.

- [ ] **[M-24] Software export query has 250k row limit but no query-level timeout**
  - Location: `apps/web/app/api/reports/software/export/route.ts:~112-129`
  - A complex filter can still run for minutes, holding a DB connection.
  - Fix: set `statement_timeout` per transaction (e.g. 30s).

- [ ] **[M-25] `/api/agent/latest` is unauthenticated and calls GitHub**
  - Location: `apps/web/app/api/agent/latest/route.ts`
  - No auth + outbound network call — DoS amplifier and infrastructure fingerprinting.
  - Fix: cache response; rate-limit; optionally require authentication for the management UI copy.

- [ ] **[M-26] PDF generation library surface (`apps/web/lib/pdf/`)**
  - Triage: confirm the PDF generator cannot be induced to fetch attacker-controlled URLs (SSRF), embed attacker-supplied HTML (XSS in PDF), or load local files. Review template rendering pipeline.
  - Fix direction: disable JavaScript and remote resource loading in the PDF engine; sanitise inputs; run inside a locked-down subprocess.

- [ ] **[M-27] Certificate import / upload does not validate size and type server-side**
  - `apps/web/lib/actions/certificates.ts` — `trackCertificateFromUpload` must bound size and reject anything that isn't a parseable PEM/DER.
  - Fix: `zod` `refine` check + explicit byte-length limit.

- [ ] **[M-28] Missing `Origin` validation on Next.js server actions**
  - Server actions accept POST from any origin unless trustedOrigins is tight.
  - Fix: configure `trustedOrigins` strictly; add middleware that rejects unknown origins.

- [ ] **[M-29] `/api/agent/bundle` autoApprove tokens bypass registration approval**
  - Location: `apps/web/app/api/agent/bundle/route.ts:~26-31`
  - Compromise of an org_admin account = silent agent enrolment at scale.
  - Fix: require separate dual-approval for `autoApprove` tokens; audit-log + email notification on generation.

- [ ] **[M-30] Inventory submission accepts arbitrarily large chunks**
  - Location: `apps/ingest/internal/handlers/inventory.go:~98-137`
  - No enforced per-chunk max size.
  - Fix: reject chunks > N packages; bail out early.

- [ ] **[M-31] Terminal session ingest WS URL derived from env; no TLS verify enforced in all paths**
  - Triage across agent, ingest, and web for any `InsecureSkipVerify: true` use. Cert refresh sweeper (`apps/ingest/internal/handlers/cert_refresh_sweeper.go:~185-188`) intentionally uses it; confirm no other paths do.
  - Fix: document + restrict `InsecureSkipVerify` to the cert-refresh sweeper; require explicit flag to enable elsewhere.

- [ ] **[M-32] LDAP injection defence also missing in `apps/web/lib/actions/ldap.ts:~254`**
  - Same root cause as C-04; separate location to be patched.
  - Fix: centralise a single LDAP-escape helper and use it everywhere.

---

## LOW

- [ ] **[L-01] SHA1 fingerprints shown in UI/API alongside SHA256**
  - `apps/web/lib/certificates/fetch.ts:~100-102`. No security impact for display, but reduces clarity and invites future misuse.
  - Fix: drop SHA1 or hide behind an "advanced" toggle.

- [ ] **[L-02] Dev TLS certs generated with 10-year expiry**
  - `start.sh:~113-118`. If copied into production, cert rotation is skipped for a decade.
  - Fix: 90–365 day dev certs; document strict cert rotation for production.

- [ ] **[L-03] `.env.example` contains only localhost defaults (safe) but lacks explicit comments on mandatory production values**
  - Fix: add comments marking which variables are security-critical; add boot-time validation (see [H-28]).

- [ ] **[L-04] Logs may leak sensitive fields if callers `console.log` the whole row**
  - Multiple server actions and handlers log raw `err` / config.
  - Fix: structured logger with automatic redaction for known sensitive keys (`password`, `token`, `bindPassword`, `config`).

- [ ] **[L-05] Non-constant-time string comparisons for tokens/fingerprints**
  - Triage for `===` comparisons of secrets across `apps/web` and Go code.
  - Fix: `timingSafeEqual` / `subtle.ConstantTimeCompare`.

- [ ] **[L-06] Task-runs custom scripts accept any body size**
  - `apps/web/lib/actions/task-runs.ts:~284-327`
  - Fix: enforce max length per interpreter; optional syntax linting.

- [ ] **[L-07] Inconsistent role constants**
  - `networks.ts`, `notification-settings.ts`, `terminal.ts`, `software-inventory.ts` each redefine `ADMIN_ROLES`.
  - Fix: centralise in `lib/auth/roles.ts`; export typed constants.

- [ ] **[L-08] `id` spread over `parsed.data` in create functions**
  - Examples: `domain-accounts.ts:~140-162, ~185-195`.
  - If future schemas add security-sensitive fields (role, orgId) they become mass-assignable.
  - Fix: destructure explicit fields instead of spreading.

- [ ] **[L-09] Cert-refresh sweeper uses `InsecureSkipVerify: true`**
  - `apps/ingest/internal/handlers/cert_refresh_sweeper.go:~185-188`. Intentional but unsafe — MITM can feed fake expiry, suppressing legitimate alerts.
  - Fix: verify against system roots where possible; make skip-verify per-target opt-in.

- [ ] **[L-10] Install-path log locations world-readable**
  - `agent/internal/install/install.go` — confirm log files are created with 0640 (owner+group) and not 0644.
  - Fix: explicit mode on log open.

- [ ] **[L-11] Response size of `getHostMetrics` and similar unbounded**
  - No cap on number of points returned — large ranges pull megabytes per request and tie up the web process.
  - Fix: cap range + points per response; paginate; encourage downsampled views by default.

- [ ] **[L-12] Silent fallbacks on environment variables**
  - `next.config.ts`, `entrypoint.sh`, `instrumentation.ts` — missing values produce surprising behaviour rather than a clean failure.
  - Fix: fail fast at boot.

---

## INFO / HARDENING

- [ ] **[I-01] No security-txt / vulnerability-disclosure policy published**
- [ ] **[I-02] No CodeQL / gosec / semgrep / trivy scans in `.github/workflows/`**
- [ ] **[I-03] No automated dependency alerting (Dependabot/Renovate config)**
- [ ] **[I-04] No secrets scanning (gitleaks/trufflehog) in CI**
- [ ] **[I-05] No SBOM produced per release**
- [ ] **[I-06] No pen-test scope / engagement doc in repo — add one alongside SECURITY.md**
- [ ] **[I-07] Mixed query styles (`db.query.X.findMany` vs. `db.select().from(X)`) complicate audits**
- [ ] **[I-08] Consider Row-Level Security (RLS) in Postgres scoped on `organisation_id`** — defence in depth should any server-side check miss its org filter
- [ ] **[I-09] Response sanitisation layer** — generic utility for stripping secret-shaped fields before returning
- [ ] **[I-10] Centralised authz helpers** — `requireRole('org_admin')`, `requireSameOrg(session, resource)` — to reduce the number of repeated (and repeatedly forgotten) checks

---

## Suggested triage ordering

1. Fix `C-01`, `C-02`, `C-04`, `C-05`, `C-06`, `C-08`, `C-09` before the pen test — these are "anyone can take over / read any org".
2. Rotate away from the dev licence public key (`C-11`) before any external distribution.
3. Wire rate limiting + CSRF + security headers (`H-01`, `H-02`, `H-27`) — cheap wins that reduce the overall attack surface.
4. Implement signed agent updates and sandboxed task execution (`C-10`, `H-22`).
5. Backfill audit logs (`M-09`) before working on the remaining medium/low items so remediation work is itself auditable.
