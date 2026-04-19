# Security Disclosure Policy

We take the security of Infrawatch / CT-Ops seriously. This document describes
how to report a vulnerability, what to expect once you do, and the scope of
our coordinated disclosure programme.

This policy applies to the upstream project hosted at
<https://github.com/carrtech-dev/ct-ops>. Operators running their own
deployment may publish additional or overriding contact information in their
own `/.well-known/security.txt` file.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Use one of
the following channels so that we can triage privately:

- **GitHub Security Advisory** (preferred):
  <https://github.com/carrtech-dev/ct-ops/security/advisories/new>
- **Email:** security@infrawatch.io

Include as much detail as you can:

- A description of the vulnerability and the affected component (web app,
  ingest service, agent, consumer, etc.).
- Steps to reproduce — a proof-of-concept, curl transcript, or minimal patch
  is ideal.
- The version, commit SHA, or container image digest you tested against.
- Any mitigations you are aware of.
- Whether you would like to be credited in the advisory, and the name /
  handle you would like us to use.

If the issue is sensitive enough that you would prefer to encrypt the report,
please open an advisory at the GitHub link above — advisories are private
until published.

## What to expect

- **Acknowledgement:** within 3 business days of receipt.
- **Initial triage:** within 10 business days, with a severity assessment and
  a rough remediation timeline.
- **Fix development:** we aim to ship fixes for Critical / High severity
  findings within 30 days of acknowledgement, and for Medium / Low findings
  within 90 days. Complex issues may take longer; we will keep you informed.
- **Coordinated disclosure:** we will agree a disclosure date with you before
  publishing the advisory. By default we request up to 90 days from
  acknowledgement before public disclosure.
- **Credit:** reporters are credited in the published advisory unless they
  ask to remain anonymous.

## Scope

In scope:

- The web application (`apps/web/`)
- The gRPC ingest service (`apps/ingest/`)
- Queue consumers (`consumers/`)
- The Go agent (`agent/`)
- The installer and packaged container images
- The official deployment profiles (`deploy/`)
- Anything under `proto/` and `packages/`

Out of scope:

- Social-engineering, phishing, and physical attacks against the project
  maintainers or operators of third-party deployments.
- Denial-of-service attacks that rely on volumetric traffic.
- Findings that require already having root on a host running the agent.
- Vulnerabilities in third-party dependencies for which no upstream fix is
  available — please report these upstream; we will coordinate the bump once
  a fix lands.
- Operator misconfiguration issues (weak database passwords, missing TLS,
  exposed dashboards) that are covered in the deployment docs. We welcome
  documentation fixes for anything that is unclear.

If you are unsure whether something is in scope, err on the side of reporting
it — we would rather hear about it and triage it out than miss a real issue.

## Safe harbour

We will not pursue legal action against security researchers who:

- Make a good-faith effort to comply with this policy.
- Avoid privacy violations, data destruction, and service degradation.
- Only interact with accounts they own or have explicit permission to test.
- Do not exploit findings beyond what is necessary to demonstrate the issue.
- Give us a reasonable amount of time to remediate before any public
  disclosure.

## Hall of fame

Published advisories live at
<https://github.com/carrtech-dev/ct-ops/security/advisories>. Reporters who
would like to be listed will be credited there.

## Keeping this policy current

This policy is versioned alongside the code. If you spot anything outdated,
please open a pull request — including fixes to the `Expires` date in
`apps/web/public/.well-known/security.txt`.
