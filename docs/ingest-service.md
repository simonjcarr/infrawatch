# Ingest Service

The ingest service is the gRPC server that sits between agents and the database. Agents connect to it, register themselves, and stream heartbeats. The web UI never talks to the ingest service directly — it reads from the same database.

---

## Responsibilities

- Validate enrolment tokens for new agent registrations
- Issue RS256 JWTs to approved agents
- Accept heartbeat streams from active agents
- Write agent status and host vitals to PostgreSQL
- Publish metrics to the internal queue (for future consumer processing)
- Expose a JWKS endpoint for JWT public key distribution

---

## Architecture

```
Agent ──gRPC+TLS──► Ingest Service ──pgx──► PostgreSQL
                         │
                         └──HTTP──► /.well-known/jwks.json
                                    /healthz
```

The ingest service is stateless except for the RSA signing key (loaded from disk at startup). Multiple instances can run behind a load balancer — they all share the database.

---

## Configuration

The ingest service reads a YAML config file (default: `/etc/ct-ops/ingest.yaml`). Pass a different path with `-config`:

```bash
ingest -config /path/to/ingest.yaml
```

### Full config reference

```yaml
# gRPC server port (TLS required)
grpc_port: 9443

# HTTP port for JWKS endpoint and health check
http_port: 8080

# PostgreSQL connection string
database_url: postgresql://ctops:ctops@db:5432/ctops

tls:
  # Path to the TLS certificate (PEM)
  cert_file: /etc/ct-ops/tls/server.crt
  # Path to the TLS private key (PEM)
  key_file: /etc/ct-ops/tls/server.key

jwt:
  # Path to the RSA private key used to sign agent JWTs.
  # Generated automatically on first start if this file does not exist.
  key_file: /var/lib/ct-ops/jwt_key.pem
  # Issuer claim in the JWT (must match what the agent expects)
  issuer: ct-ops-ingest
  # How long issued JWTs are valid for
  token_ttl: 24h

queue:
  # "inprocess" uses buffered channels — suitable for <50 hosts (single node)
  # "redpanda" will be added in a later release
  type: inprocess
```

### Environment variable overrides

| Environment variable | Config equivalent |
|---|---|
| `DATABASE_URL` or `INGEST_DATABASE_URL` | `database_url` |
| `INGEST_GRPC_PORT` | `grpc_port` |
| `INGEST_TLS_CERT` | `tls.cert_file` |
| `INGEST_TLS_KEY` | `tls.key_file` |
| `INGEST_JWT_KEY_FILE` | `jwt.key_file` |

---

## TLS

The ingest service requires TLS. Without it, gRPC connections are rejected.

**Development:** use `make dev-tls` to generate a self-signed certificate into `deploy/dev-tls/`. Mount this into the container and point agents at the `server.crt` file via `ca_cert_file` in the agent config.

**Production:** use a certificate from your corporate CA or a public CA. Agents using a public CA can leave `ca_cert_file` empty and rely on system roots.

---

## JWT signing key

On first startup, if `jwt.key_file` does not exist, the service generates a 2048-bit RSA key and writes it to that path. Subsequent restarts load the same key.

**Back this file up.** If you lose it, all existing agent JWTs become invalid and every agent will need to re-register (they'll go through registration again and receive a new JWT automatically, but there will be a gap in heartbeat data).

---

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 9443 | gRPC over TLS | Agent connections (Register + Heartbeat RPCs) |
| 8080 | HTTP | `/.well-known/jwks.json` JWKS endpoint, `/healthz` health check |

---

## Health check

```bash
curl http://localhost:8080/healthz
# → ok
```

The Docker Compose health check uses this endpoint. The ingest container is only marked healthy once this responds.

---

## Endpoints

### `/.well-known/jwks.json`

Returns the RSA public key as a JSON Web Key Set. The web application will use this in a future session to verify agent JWTs for inbound webhook authentication.

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "n": "...",
      "e": "..."
    }
  ]
}
```

---

## Logs

The ingest service logs to stdout in structured text format. Each RPC call is logged with method, status code, and duration:

```
time=... level=INFO msg="database connected"
time=... level=INFO msg="JWT issuer ready" issuer=ct-ops-ingest
time=... level=INFO msg="gRPC server starting" port=9443
time=... level=INFO msg="grpc stream opened" method=/agent.v1.IngestService/Heartbeat peer=192.168.1.10:54321
time=... level=INFO msg="agent registered" agent_id=abc123 hostname=web-01 auto_approve=true
time=... level=INFO msg="heartbeat stream ended, agent marked offline" agent_id=abc123
```

---

## Building

```bash
# From the repo root
make ingest
# Binary at: dist/ingest

# Or directly
go build -o dist/ingest ./apps/ingest/cmd/ingest
```

### Docker

The `apps/ingest/Dockerfile` produces a minimal Alpine-based image. It is built as part of `docker-compose.single.yml`:

```bash
docker compose -f docker-compose.single.yml build ingest
```
