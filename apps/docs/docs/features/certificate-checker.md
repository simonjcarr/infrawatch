# SSL Certificate Checker

The SSL Certificate Checker is an interactive tool in the **Tooling** section that lets engineers inspect, validate, and convert X.509 certificates without needing `openssl` on their local machine.

## Features

- **Upload a certificate** in PEM, DER, PKCS#7 (.p7b), or PKCS#12 (.pfx/.p12) formats
- **Fetch live certificates** directly from any TLS-protected URL or hostname
- **Validate a private key** against the loaded certificate to confirm they match
- **Download certificates** in PEM, DER, or PKCS#7 format
- **Full certificate detail** — every field extracted and displayed in a readable layout

## How to Use

### 1. Upload a Certificate File

1. Navigate to **Tooling → SSL Certificate Checker** in the sidebar.
2. Select the **Upload File** tab.
3. Drag-and-drop or click to browse for your certificate file.
4. For PKCS#12 (`.pfx` / `.p12`) files, enter the password in the **Password** field that appears.
5. Click **Analyse Certificate**.

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
5. Click **Fetch Certificate**.

The tool connects server-side, so it can reach internal hosts that your browser cannot access directly.

### 3. Validate a Private Key

After loading a certificate, a **Validate Private Key** panel appears at the bottom of the results.

1. Paste the PEM-encoded private key into the text area.
2. Click **Validate Key**.
3. A green or red banner will confirm whether the key matches the certificate's public key.

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
| **Validity & Fingerprints** | Not before, not after, serial number, SHA-1 / SHA-256 / SHA-512 fingerprints |
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
