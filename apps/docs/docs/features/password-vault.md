# Password Vault

Password Vault is the built-in CT Ops secret store now being added to the
product. The first release is focused on a secure multi-user core: local unlock
in the browser, encrypted vault entries, shared vault access, and backend
enforcement for organisation scope, membership, and audit trails.

This page describes the MVP target and security boundary. It does not promise
deferred capabilities such as browser extensions, third-party imports, or admin
recovery.

## MVP Scope

The first Password Vault release is designed to let CT Ops users:

- create a local unlock profile without sending the unlock password to the
  server;
- create encrypted vaults and encrypted entries in the browser;
- share a vault with other CT Ops users through per-user wrapped vault keys;
- lock and unlock the vault separately from the main CT Ops login session;
- audit sensitive actions such as create, update, delete, reveal, copy, share,
  revoke, and key rotation.

The server still enforces organisation boundaries, membership, roles, rate
limits, payload validation, and trusted mutation-origin checks. Client-side
crypto does not replace backend authorization.

## How Unlock Works

Password Vault uses a dedicated unlock password that stays in the browser.

1. You choose an unlock password locally.
2. The browser derives an unlock key with Argon2id.
3. That unlock key decrypts your private key envelope locally when you unlock.
4. Vault keys are generated in the browser and wrapped to each authorised user.
5. Vault names, entry titles, usernames, passwords, URLs, notes, TOTP seeds,
   tags, and custom fields stay encrypted before they reach the API.

CT Ops stores encrypted envelopes, public keys, and metadata needed for access
control and auditing, but not plaintext secrets or the unlock password.

## Shared Vaults

The MVP is multi-user from the start. Each shared vault keeps one active vault
key epoch, and every authorised member receives their own wrapped copy of that
vault key.

- Owners and admins can grant access to other CT Ops users in the same
  organisation.
- Removing a member blocks backend access immediately.
- Removing a member also requires a key-rotation flow so future updates use a
  fresh vault-key epoch.

Password Vault cannot claw back secrets that a removed member already revealed,
copied, or stored elsewhere before access was revoked.

## Recovery and Trust Limits

The MVP has no admin recovery and no organisation escrow.

- CT Ops administrators cannot reset the vault into a readable state.
- Support staff cannot recover a forgotten unlock password.
- If no authorised unlocked member can re-share access, lost unlock credentials
  make the encrypted data unrecoverable.

Password Vault is designed so routine backend, database, log, and backup access
does not expose plaintext secrets. It is not a promise that a compromised CT
Ops web build could never capture secrets, because the browser must trust the
JavaScript it loads.

## Not In The MVP

These items are intentionally out of scope for the first release:

- third-party password-manager import;
- browser extensions;
- attachments;
- breach checks and password-health scoring;
- emergency access;
- admin or organisation recovery.

For the detailed internal design and threat model that implementation work
follows, see the architecture notes maintained in the main CT Ops repository.
