# Ingest Service

The ingest service is a stateless gRPC server that sits between the agents and the database. It is the only service that agents communicate with directly — the web app reads from the same database and never talks to ingest in the request path.

---

## Architecture

```
Agent ──gRPC+TLS──► Ingest Service ──pgx──► PostgreSQL
                         │
                         └──HTTP──► /.well-known/jwks.json
                                    /healthz
```

---

## Responsibilities

- Validate enrolment tokens for new agent registrations
- Issue RS256 JWTs to approved agents
- Accept bidirectional heartbeat streams from active agents
- Write agent status and host vitals to PostgreSQL
- Publish metrics to the internal queue (for consumer processing)
- Expose a JWKS endpoint for JWT public key distribution

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `INGEST_TLS_CERT` | ✓ | — | Path to TLS certificate (PEM) |
| `INGEST_TLS_KEY` | ✓ | — | Path to TLS private key (PEM) |
| `INGEST_JWT_KEY_FILE` | — | `/var/lib/infrawatch/jwt_key.pem` | RSA private key for JWT signing. Auto-generated on first start if missing. |
| `INGEST_GRPC_PORT` | — | `9443` | gRPC listener port |
| `INGEST_HTTP_PORT` | — | `8080` | HTTP port for JWKS and health check |
| `INGEST_AGENT_DOWNLOAD_BASE_URL` | — | `http://localhost:3000` | Public URL of the web app — agents construct their binary download URL from this. Must be reachable from agent hosts. |

:::warning JWT Key Backup
Back up the JWT key file. Losing it invalidates all existing agent JWTs and forces every agent to re-register.
:::

---

## TLS

TLS is **required** for all gRPC connections. Agents connect over mTLS.

**Development:** Generate a self-signed cert with:

```bash
make dev-tls
```

This creates `deploy/dev-tls/server.crt` and `deploy/dev-tls/server.key`. Mount them into the ingest container and point agents at `server.crt` via `ca_cert_file` in the agent config.

**Production:** Use a certificate from your corporate CA or a public CA. Agents connecting to a publicly trusted cert can leave `ca_cert_file` empty.

---

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 9443 | gRPC over TLS | Agent connections |
| 8080 | HTTP | JWKS endpoint, health check |

---

## HTTP Endpoints

### `GET /healthz`

Returns `ok` with HTTP 200 when the service is healthy. Used by Docker Compose health checks.

```bash
curl http://localhost:8080/healthz
# ok
```

### `GET /.well-known/jwks.json`

Returns the RSA public key as a JWKS document. Used by the web app to verify agent JWTs for webhook authentication.

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "...",
      "use": "sig",
      "alg": "RS256",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

---

## JWT Signing Key

The RSA key is loaded from `INGEST_JWT_KEY_FILE` at startup. If the file does not exist, a 2048-bit RSA key is generated automatically and written to disk.

JWTs are signed with RS256 and include:
- `sub` — agent ID
- `iss` — `infrawatch-ingest`
- `exp` — 24 h from issuance

---

## Scaling

The ingest service is stateless. Multiple instances can run behind a load balancer sharing the same PostgreSQL database. The only shared state is the RSA signing key — all instances must use the same key file (or share the key via a secrets manager).

---

## Building

```bash
# From repo root
make ingest

# Or directly
go build -o dist/ingest ./apps/ingest/cmd/ingest
```

The Docker image is built as part of `docker-compose.single.yml`. See [Deployment](../deployment/docker-compose) for production deployment instructions.
