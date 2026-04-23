# mTLS: agent ↔ server authentication

All gRPC traffic between agents and the ingest service is authenticated with
**mutual TLS**. Each agent proves its wire identity with an X.509 client
certificate signed by the internal **agent CA**, in addition to the agent
JWT issued at registration. The two must match: the SPIFFE URI encoded in
the client cert names the same agent ID as the JWT `sub` claim.

This page covers:

- the trust model,
- how the CA is managed (auto vs. BYO),
- the certificate lifecycle,
- rotation and revocation,
- the breaking-upgrade note for existing deployments.

## Trust model

Two independent PKIs keep concerns separate:

| PKI | Purpose | Where the private key lives | Who issues |
|---|---|---|---|
| **Server TLS** | What the agent validates when dialling ingest | `INGEST_TLS_KEY` on the ingest host | Operator (BYO) or dev script |
| **Agent CA** | Signs per-agent **client** certificates | Postgres (AES-256-GCM encrypted) or env-file BYO | Auto-generated on first boot, or uploaded |

The browser ↔ server channel (dashboard, terminal WebSocket, etc.) is out of
scope for mTLS — browsers can't reliably present client certificates through
normal UI flows. That channel is authenticated via the Better Auth session
cookie plus a one-shot session row for live terminal sessions. The
**agent-side half** of a terminal session is the agent ↔ ingest gRPC
bidirectional stream, which is covered by mTLS like every other RPC.

## Agent CA lifecycle

### Auto-generation (default)

On first boot the ingest service checks the `certificate_authorities` table
for an active row with `purpose = 'agent_ca'`. If absent, it generates a
fresh ECDSA P-256 CA valid for 10 years, stores the PEM cert in the same
table alongside an AES-256-GCM-encrypted copy of the private key (derived
from `LDAP_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` — matches
`apps/web/lib/crypto/encrypt.ts`), and wires it into the gRPC TLS config.

The CA survives container rebuilds because it's in the database, not on the
ingest volume.

### Bring-your-own

Two equivalent ways to supply an existing intermediate or root CA:

1. **Env-file override** — mount your cert/key and set:
   - `INGEST_AGENT_CA_CERT=/path/to/ca.crt`
   - `INGEST_AGENT_CA_KEY=/path/to/ca.key`
   Ingest reads these on every boot. The DB row is still upserted so the
   admin UI can show metadata.
2. **Admin UI upload** — **Settings → Security / mTLS → Upload a custom
   CA**. Paste the cert PEM and key PEM. Validation:
   - cert parses,
   - key matches the cert public key,
   - `BasicConstraints.CA = true`,
   - `notAfter` is in the future.

Uploads replace the active CA via soft-delete; the old CA stays in the
ingest trust pool until every leaf it signed has expired, so there's no
downtime. The UI shows the overlap window.

## Per-agent client cert lifecycle

### Issuance

1. Agent boots, loads its Ed25519 keypair from `${DATA_DIR}/agent_key.pem`
   (generated on first ever start).
2. Agent builds a DER-encoded PKCS#10 CSR signed with that key.
3. Agent calls `Register(RegisterRequest{ csr_der, public_key, org_token, … })`.
4. Ingest validates the CSR signature, stashes it in
   `pending_cert_signings`, and returns `status = pending` until an admin
   approves the agent (auto-approve tokens short-circuit this: the sign
   happens inline and the cert ships in the `RegisterResponse`).
5. On approval, a sweeper inside ingest picks the queued CSR up,
   signs with the agent CA (validity 90 days), and writes the leaf onto the
   agents row.
6. The agent's next Register poll receives the signed cert and persists
   `agent_cert.pem` atomically. From then on every dial presents the cert.

### Rotation

The agent checks its leaf expiry on every stream open. Inside the renewal
window (last one-third of validity, ~day 60), it generates a fresh CSR and
calls the `RenewCertificate` RPC over the current (still-valid) mTLS
connection. The server signs and returns a new leaf; the agent swaps on
disk and redials.

Admin-initiated rotation (e.g. CA rotation) delivers the new cert via
`HeartbeatResponse.pending_client_cert_pem` on the next 2-second poll tick.
The agent saves atomically, closes the current stream, and redials with
the new cert.

### Revocation

Admin revoke actions (**reject pending agent**, **delete host**) add the
agent's current client cert serial to the `revoked_certificates` table.
Ingest keeps this list in an in-memory set, refreshed every 5 seconds.
The `VerifyPeerCertificate` TLS callback rejects any handshake whose leaf
serial is in the set. Effect: the next handshake from a revoked agent
terminates with an alert; all subsequent dials fail until the cert expires
or the serial is removed.

## Rollout and migration

::: danger Breaking change
The ingest service enforces `RequireAndVerifyClientCert` from day one.
**Any existing agent installed before this release must be re-enrolled** so
it can send a CSR and receive a client cert. Old installations will see
their heartbeats fail with `UNAUTHENTICATED`.

The operator steps are:

1. Upgrade the ct-ops server to the release that includes this feature.
2. Trigger a re-enrolment (download a fresh agent bundle from **Settings →
   Agent Enrolment**, run `install.sh`/`install.ps1` on each host). The
   agent's Ed25519 keypair is preserved unless the data directory is
   wiped; only the client cert is newly issued.
3. Approve each pending agent (unchanged flow).

If you operate a large fleet, document the cut-over window in your change
management plan — there is no JWT-only compatibility mode.
:::

## Inspecting certificates

- **Server TLS cert and agent CA metadata** — **Settings → Security / mTLS**.
- **Per-agent client cert** — agents detail view in the dashboard includes
  serial, SHA-256 fingerprint, issued-at, expires-at, and renewal state.
- **On the agent host** — `${DATA_DIR}/agent_cert.pem` and
  `${DATA_DIR}/agent_ca.pem`. Inspect with:
  `openssl x509 -in agent_cert.pem -noout -text`.

## CLI smoke test

```
# From a host that has the agent CA PEM and the server CA PEM:
openssl s_client \
  -connect ingest.example.com:9443 \
  -cert /var/lib/ct-ops/agent/agent_cert.pem \
  -key  /var/lib/ct-ops/agent/agent_key.pem \
  -CAfile /path/to/server-ca.crt
```

Without the `-cert`/`-key` pair the TLS alert is immediate — this confirms
the server is requiring client certs.

## Environment reference

| Variable | Purpose | Default |
|---|---|---|
| `INGEST_TLS_CERT` | Server TLS cert (agents validate this) | `/etc/ct-ops/tls/server.crt` |
| `INGEST_TLS_KEY`  | Server TLS key | `/etc/ct-ops/tls/server.key` |
| `INGEST_AGENT_CA_CERT` | BYO agent CA cert (overrides DB) | unset |
| `INGEST_AGENT_CA_KEY`  | BYO agent CA key | unset |
| `LDAP_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` | Encrypts the CA key at rest in the DB | set in `.env` |

| Agent file | Purpose |
|---|---|
| `${DATA_DIR}/agent_key.pem` | Ed25519 identity private key — **never share** |
| `${DATA_DIR}/agent_key.pub` | Ed25519 identity public key |
| `${DATA_DIR}/agent_cert.pem` | Signed client cert, used for mTLS |
| `${DATA_DIR}/agent_ca.pem`   | Server-provided agent CA cert bundle for reference |
| `${DATA_DIR}/agent_state.json` | Persisted agent_id + JWT |
