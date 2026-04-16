# Architecture Overview

Infrawatch is a monorepo composed of several independently deployable services. This page describes the high-level architecture and how data flows through the system.

---

## System Diagram


<img
  style="max-width: 100%; height: auto; display: block;"
  alt="System Diagram"
  src="https://github.com/user-attachments/assets/c242cb2d-acf6-491e-9ef0-eaafe839a3d3"
/>


---

## Components

### Go Agent

A statically compiled Go binary. Runs on each monitored host with no runtime dependencies. Communicates exclusively via gRPC over mTLS (port 443 or 9443). See [Agent Architecture](./agent) for the full registration and heartbeat flow.

### Ingest Service

A stateless gRPC server that sits between the agents and the database. Responsibilities:
- Validates enrolment tokens for new registrations
- Issues RS256 JWTs to approved agents
- Accepts bidirectional heartbeat streams
- Writes agent vitals and status to PostgreSQL
- Publishes events to the internal queue

The ingest service is stateless (except for the RSA signing key on disk) — multiple instances can run behind a load balancer sharing the same database.

### Queue

The queue is abstracted behind an interface, allowing the implementation to be swapped via configuration:

| Profile | Queue type | When to use |
|---|---|---|
| `small` | In-process (Go channels + WAL) | < 50 hosts |
| `standard` | Redpanda single node | Most organisations |
| `ha` | Redpanda cluster | High availability required |

### Consumers

Separate Go binaries that consume from the queue and write to PostgreSQL. Independently scalable.

| Consumer | Writes to |
|---|---|
| `consumers/metrics` | TimescaleDB time-series tables |
| `consumers/alerts` | Alert instances, evaluates alert rules |
| `consumers/events` | Events spine, triggers webhooks |

### Web Application

A Next.js 15 (App Router) application. Reads directly from PostgreSQL via Drizzle ORM. Writes via Server Actions. All data fetching uses TanStack Query on the client side.

The web app never talks directly to the ingest service in the request path — it reads the same database that consumers write to. The only real-time connection is a WebSocket to the ingest service for live agent status updates.

---

## Data Flow

### Agent registration

```
Agent → Register RPC → Ingest → Validates token → Inserts host record
                                                 → Issues JWT
                                                 → Returns agent_id + status
Agent ← JWT ← Ingest
Agent → Heartbeat stream → Ingest → Writes vitals to DB → Queue → TimescaleDB
```

### Alert evaluation

```
Ingest → Queue (metrics.raw) → Alerts Consumer → Evaluates rules → Inserts alert instances
                                                                  → Inserts notifications
Web App → Reads notifications → Displays in notification bell
```

---

## Database

PostgreSQL with the TimescaleDB extension. Used for:
- **TimescaleDB hypertables** — metrics time-series (CPU, memory, disk, network)
- **Standard tables** — hosts, agents, certificates, alerts, notifications, events

TimescaleDB provides continuous aggregates for efficient querying of historical metric data without full table scans.

---

## Authentication

Better Auth handles session management, email/password auth, TOTP MFA, and API keys. LDAP/Active Directory integration syncs domain accounts for service account inventory. SAML/OIDC (enterprise tier) is structured but not yet active.

---

## Further Reading

- [Agent Architecture](./agent) — Registration flow, identity model, reconnection
- [Ingest Service](./ingest) — gRPC API, JWT issuance, JWKS endpoint
- [Deployment Profiles](./deployment-profiles) — single / standard / HA
