# Security & Vulnerability Disclosure

CT-Ops follows a coordinated vulnerability disclosure policy. The full text
lives at [SECURITY_DISCLOSURE.md](https://github.com/carrtech-dev/ct-ops/blob/main/SECURITY_DISCLOSURE.md)
in the repository.

## Reporting a vulnerability

Do **not** open a public GitHub issue. Use one of:

- **GitHub Security Advisory** (preferred):
  <https://github.com/carrtech-dev/ct-ops/security/advisories/new>
- **Email:** security@infrawatch.io

Please include reproduction steps, affected version / commit / image digest,
and any known mitigations.

## What to expect

- Acknowledgement within 3 business days.
- Initial triage and severity assessment within 10 business days.
- Target fix windows: 30 days for Critical / High, 90 days for Medium / Low.
- We will agree a disclosure date with you before publishing any advisory.

## security.txt

Every deployment serves [`/.well-known/security.txt`](https://github.com/carrtech-dev/ct-ops/blob/main/apps/web/public/.well-known/security.txt)
as per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116). The file ships
with the upstream project's contact details; operators running their own
deployment may replace it with their own security contact so that researchers
can reach the team responsible for that installation.

To override for a deployment, edit `apps/web/public/.well-known/security.txt`
in your fork before building the image, or mount a replacement file over the
path in your container.

## Safe harbour

See [SECURITY_DISCLOSURE.md](https://github.com/carrtech-dev/ct-ops/blob/main/SECURITY_DISCLOSURE.md#safe-harbour)
for the full safe-harbour statement. In short: act in good faith, avoid data
destruction or privacy violations, give us a reasonable window to remediate,
and we will not pursue legal action.

## Published advisories

Past and pending advisories are listed at
<https://github.com/carrtech-dev/ct-ops/security/advisories>.
