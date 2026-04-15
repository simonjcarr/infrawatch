# Deployment Profiles

Infrawatch ships with three deployment profiles, each targeting a different scale. All profiles use the same codebase — only the infrastructure backing them changes.

---

## Profile Comparison

| Profile | Queue | Ingest instances | Database | Suitable for |
|---|---|---|---|---|
| `single` | In-process (channels + WAL) | 1 | PostgreSQL (single node) | < 50 hosts, homelab, trial |
| `standard` | Redpanda (single node) | 1 | PostgreSQL (single node) | Most organisations |
| `ha` | Redpanda cluster | Multiple (behind HAProxy) | PostgreSQL primary + replica | High availability required |

---

## Single Profile

The simplest deployment. Everything runs on one machine in Docker Compose. The queue is implemented with Go channels backed by a write-ahead log — no Redpanda, no separate consumer processes.

```yaml title="docker-compose.single.yml"
services:
  db:       # PostgreSQL + TimescaleDB
  web:      # Next.js, includes embedded consumers
  ingest:   # gRPC ingest service
```

**Use when:**
- Evaluating Infrawatch
- Small infrastructure (< 50 agents)
- A single point of failure is acceptable

---

## Standard Profile

Adds Redpanda as a single-node message queue. The metrics, alerts, and events consumers run as separate processes. More resilient — the queue buffers data if consumers are temporarily offline.

```
docker-compose.standard.yml
├── db          (PostgreSQL + TimescaleDB)
├── redpanda    (single node)
├── web         (Next.js)
├── ingest      (gRPC)
├── consumer-metrics
├── consumer-alerts
└── consumer-events
```

**Use when:**
- Running 50–500 agents
- You want Redpanda's durability guarantees
- Single machine is still acceptable

---

## HA Profile

Full high-availability configuration. Multiple ingest and web instances behind HAProxy. PostgreSQL primary/replica pair. Redpanda cluster (3 nodes).

```
docker-compose.ha.yml
├── db-primary        (PostgreSQL + TimescaleDB)
├── db-replica
├── redpanda-1
├── redpanda-2
├── redpanda-3
├── web-1             (Next.js)
├── web-2
├── ingest-1          (gRPC)
├── ingest-2
├── haproxy
├── consumer-metrics
├── consumer-alerts
└── consumer-events
```

**Use when:**
- Running 500+ agents
- Downtime is not acceptable
- You need horizontal scaling

---

## Queue Topic Reference

Regardless of which queue implementation is in use, the topics are:

| Topic | Written by | Consumed by |
|---|---|---|
| `metrics.raw` | Ingest | Metrics consumer |
| `events.raw` | Ingest | Events consumer |
| `alerts.pending` | Alerts consumer | — |
| `agent.status` | Ingest | Events consumer |

---

## Switching Profiles

Profiles are not currently hot-swappable. To move from `single` to `standard`:

1. Take a PostgreSQL backup: `pg_dump infrawatch > backup.sql`
2. `docker compose -f docker-compose.single.yml down`
3. `docker compose -f docker-compose.standard.yml up -d`
4. Restore the backup if needed

---

## Air-Gap Deployment

All three profiles support fully offline deployment. See [Air-Gap Deployment](../deployment/air-gap) for the bundle and transfer instructions.
