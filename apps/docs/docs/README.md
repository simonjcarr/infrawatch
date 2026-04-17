# Introduction

Infrawatch is an open-source infrastructure monitoring and tooling platform built for corporate engineering teams and individual operators who need full control over their observability stack.

## What is Infrawatch?

Infrawatch gives you a single place to manage and monitor your server infrastructure — without sending data to a third-party cloud.

Core capabilities:

- **Agent-based server monitoring** — A lightweight Go agent runs on each host, streaming metrics and running checks over gRPC with mTLS
- **Certificate lifecycle management** — Track TLS certificates across your infrastructure and get expiry alerts before they cause outages
- **Service account and identity tracking** — Inventory domain accounts, SSH keys, and users across your fleet via LDAP/Active Directory sync
- **Infrastructure tooling** — A persistent terminal panel, custom script runner, service management, task runner, and runbooks
- **Alerting and notification routing** — Rule-based alerts with channels for Slack, SMTP, Webhooks, Telegram, and in-app notifications

## Who is Infrawatch for?

- **Engineering and platform teams** who run their own servers and want a self-hosted alternative to cloud observability products
- **Security-conscious operators** who require air-gapped deployments with zero external dependencies
- **Ops teams** who need a single pane of glass for server inventory, certificate expiry, service accounts, and alert management

## Key Design Principles

### No External Dependencies
Every feature works in a fully air-gapped environment. No cloud APIs, no CDNs, no phone-home. Agent binary updates are served from your own Infrawatch server.

### Open Agent
The agent is Apache 2.0 licensed and always will be. Security teams must be able to audit what runs on their hosts.

### Offline-Capable Licensing
Enterprise licence validation uses a signed JWT verified against a bundled public key. No external service required.

---

## Quick Links

| | |
|---|---|
| [Installation](./getting-started/installation) | Get Infrawatch running in under 5 minutes |
| [Offline Agent Install Bundle](./getting-started/agent-install-bundle) | Download a portable zip to install agents on air-gapped hosts |
| [Architecture Overview](./architecture/overview) | Understand how the components fit together |
| [Agent Architecture](./architecture/agent) | Registration flow, identity model, self-update |
| [Ingest Service](./architecture/ingest) | gRPC gateway, JWT issuance, queue |
| [Deployment Profiles](./architecture/deployment-profiles) | single / standard / HA configurations |
| [Air-Gap Deployment](./deployment/air-gap) | Run Infrawatch with zero external dependencies |
