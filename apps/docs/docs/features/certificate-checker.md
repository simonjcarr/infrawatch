# SSL Certificate Checker

The SSL Certificate Checker is an interactive tool in the **Tooling** section that lets engineers inspect, validate, and convert X.509 certificates without needing `openssl` on their local machine.

## Features

- **Three ways to supply a certificate** — drag-and-drop a file, click to browse, or paste PEM text directly
- **Fetch live certificates** directly from any TLS-protected URL or hostname
- **Inline private key validation** — optionally supply a private key (dropped, uploaded, or pasted) and the match result is returned alongside the certificate details
- **Supports PEM, DER, PKCS#7 (.p7b), and PKCS#12 (.pfx/.p12)** formats
- **Download certificates** in PEM, DER, or PKCS#7 format
- **Full certificate detail** — every field extracted and displayed in a readable layout

## How to Use

### 1. Supply a Certificate (Upload / Paste)

1. Navigate to **Tooling → SSL Certificate Checker** in the sidebar.
2. Select the **Upload / Paste** tab.
3. Provide the certificate in whichever way is easiest:
   - **Drag-and-drop** a file onto the drop zone
   - **Click** the drop zone to browse for a file
   - **Paste** PEM-encoded text directly into the textarea
4. For PKCS#12 (`.pfx` / `.p12`) files, enter the password in the **Password** field that appears.
5. (Optional) Supply a private key in the **Private Key** field — drop, browse, or paste — to validate it against the certificate in the same request.
6. Click **Analyse Certificate**.

PEM/text files (`.pem`, `.crt`, `.cer`, `.key`) dropped onto the zone are read as text and auto-populate the paste area so you can review the content before submitting. Binary files (DER, PKCS#12) are kept as file references and sent as base64.

Supported formats:

| Format | Extensions |
|--------|------------|
| PEM (text) | `.pem`, `.crt`, `.cer` |
| DER (binary) | `.der`, `.cer` |
| PKCS#7 bundle | `.p7b`, `.p7c` |
| PKCS#12 (password-protected) | `.pfx`, `.p12` |

### 2. Fetch a Live Certificate from a URL

1. Select the **Check URL** tab.
2. Enter a hostname or full URL (e.g. `example.com` or `https://example.com`).
3. Adjust **Port** if the service isn't on 443.
4. Optionally set an **SNI Override** if the TLS server name differs from the hostname (useful for IP addresses or CDN backends).
5. (Optional) Supply a private key in the **Private Key** field to validate it against the fetched certificate.
6. Click **Fetch Certificate**.

The tool connects server-side, so it can reach internal hosts that your browser cannot access directly.

### 3. Private Key Validation

The private key field is available **upfront** on both the Upload/Paste and Check URL tabs — you don't need to wait for the certificate to load first. Validation runs in the same API call as certificate parsing/fetching, and the match result appears alongside the certificate details.

A green banner confirms the key matches the certificate's public key; a red banner indicates a mismatch.

::: tip
The private key is transmitted to the server for validation and is not stored. For sensitive keys, use this tool only on trusted internal deployments.
:::

### 4. Download the Certificate

Use the **Download** button in the results header to export the leaf certificate in your preferred format:

- **PEM** — base64-encoded text, widely compatible
- **DER** — raw binary, used by Java keystores and some Windows tools
- **PKCS#7** — bundle format supported by IIS and other Windows services

## Certificate Information Displayed

| Section | Fields |
|---------|--------|
| **Summary** | Valid from/to, key type/size, issuer, expiry countdown |
| **Subject** | CN, O, OU, C, ST, L, full DN |
| **Issuer** | CN, O, full DN |
| **Validity & Fingerprints** | Not before, not after, serial number, SHA-256 / SHA-512 fingerprints |
| **Key & Algorithm** | Key algorithm, key size, curve (EC), signature algorithm, Subject Key ID, Authority Key ID |
| **Extensions** | CA flag, path length, key usage, extended key usage, certificate policies |
| **Subject Alternative Names** | All DNS, IP, email, and URI SANs |
| **Revocation & Authority Info** | OCSP responder URLs, CA issuer URLs, CRL distribution points |
| **Certificate Chain** | Subject, issuer, expiry, and CA/end-entity type for each chain entry |
| **PEM** | Raw PEM text with one-click copy |

## Status Indicators

| Indicator | Meaning |
|-----------|---------|
| **Valid** (green) | Certificate is within its validity period and more than 30 days from expiry |
| **Expiring Soon** (amber) | Certificate expires within 30 days |
| **Expired** (red) | Certificate has passed its `Not After` date |
| **Self-Signed** badge | Subject and issuer are identical |
| **CA Certificate** badge | Basic Constraints `cA=TRUE` is set |

## Promoting a Certificate into the Tracker

Once a certificate is loaded in the Checker (from either tab), a **Track this certificate** button appears on the results panel. Clicking it adds the certificate to the [Certificate Tracker](./certificates) so expiry is monitored on an ongoing basis.

Two tracking modes are available, selected automatically based on the source tab:

### URL-tracked (Check URL tab)

The server periodically re-opens a TLS connection to the URL you checked and refreshes the certificate data. This keeps the tracker automatically in sync across renewals.

- You pick a refresh interval when you click **Track this certificate** — 15 minutes, 1 hour (default), 6 hours, or 24 hours.
- On every refresh the server re-reads `notAfter` and recomputes status.
- If the fingerprint changes, the tracker detects a renewal automatically: the old row is retained for history and a new row takes over as the current tracked certificate.
- If the endpoint is temporarily unreachable (DNS failure, TCP timeout, TLS handshake error), the last known certificate data is preserved and the failure is recorded so the expiry reminder still works.

### Upload-tracked (Upload File tab)

Used when the certificate was uploaded or pasted — typically an air-gapped host or an out-of-band copy the server cannot reach over TLS.

- The certificate is tracked as a **static expiry reminder** based on the `notAfter` baked into the certificate.
- There is no periodic re-check. When the certificate is renewed, re-upload the new one via the Checker and click **Track this certificate** again.

::: tip
If a certificate is already tracked, the Checker will tell you and link directly to the existing row rather than creating a duplicate.
:::
