# Password Vault

Password Vault is CT-Ops's built-in shared secret vault for engineering teams
that want to keep credentials inside the same self-hosted platform they already
use for infrastructure operations.

The Password Vault MVP is designed around a simple boundary:

- secret-bearing vault data is encrypted in the browser before it is sent to CT-Ops;
- CT-Ops enforces organisation scope, membership, roles, audit logging, and API
  safeguards on the backend;
- there is no admin recovery path that would let the server decrypt your vault
  data for you.

## What lives in the vault

Vault entries are intended for operational secrets such as:

- shared service credentials
- infrastructure login details
- internal URLs and notes that should stay alongside a secret
- TOTP seeds and other small structured secret fields

The MVP is for text-based secret records. It does not include browser
extensions, third-party importers, attachments, or server-side plaintext search.

## Security model

Password Vault uses a browser-first encryption model:

- your unlock password stays in the browser;
- CT-Ops stores encrypted vault data, encrypted private-key material, and
  per-user wrapped vault keys;
- CT-Ops administrators, database snapshots, backups, and logs should not have
  access to plaintext vault contents during normal operation.

This reduces the blast radius of a database or backup leak, but it is not a
promise that CT-Ops can never influence confidentiality. Like any web
application, a compromised CT-Ops deployment could serve malicious JavaScript.

## Multi-user sharing

Password Vault is built for shared operational access, not just personal
storage.

- vaults are scoped to your CT-Ops organisation;
- multiple authorised users can access the same vault;
- access is granted through per-user wrapped vault keys rather than a backend
  copy of the plaintext vault key;
- removing a member blocks future backend access and requires key rotation for
  future secrecy.

## Recovery posture

The MVP deliberately has no admin or organisation recovery flow.

- CT-Ops support staff cannot reset a vault into a readable state;
- CT-Ops does not keep a server-side escrow copy of your unlock material;
- if a user loses the unlock password and no already-authorised unlocked member
  can re-share access, the encrypted data is unrecoverable.

This is a security tradeoff, not a temporary support gap.

## Expected MVP capabilities

The Password Vault MVP is scoped to the core workflows needed for a secure team
vault inside CT-Ops:

- set up a local unlock profile without sending the unlock password to the
  server;
- create shared vaults inside an organisation;
- add, update, reveal, copy, and delete encrypted entries;
- share vault access with other CT-Ops users;
- revoke access and rotate key material when membership changes;
- record security-sensitive actions in audit logs without storing secret values.
