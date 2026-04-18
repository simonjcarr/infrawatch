import { NextRequest, NextResponse } from 'next/server'
import * as tls from 'tls'
import * as crypto from 'crypto'
import * as forge from 'node-forge'
import { z } from 'zod'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ParsedSAN {
  type: string
  value: string
}

export interface ChainEntry {
  subject: string
  issuer: string
  notBefore: string
  notAfter: string
  fingerprintSha256: string
  isCA: boolean
}

export interface ParsedCertificate {
  // Subject info
  subject: string
  commonName: string
  organization: string
  organizationalUnit: string
  country: string
  state: string
  locality: string

  // Issuer info
  issuer: string
  issuerCommonName: string
  issuerOrganization: string

  // Validity
  notBefore: string
  notAfter: string
  daysRemaining: number
  isExpired: boolean
  isExpiringSoon: boolean

  // Identity
  serialNumber: string
  fingerprintSha1: string
  fingerprintSha256: string
  fingerprintSha512: string
  isSelfSigned: boolean

  // Key info
  keyAlgorithm: string
  keySize: number | null
  curve: string | null
  signatureAlgorithm: string

  // Extensions
  sans: ParsedSAN[]
  keyUsage: string[]
  extendedKeyUsage: string[]
  isCA: boolean
  pathLength: number | null
  subjectKeyId: string | null
  authorityKeyId: string | null
  ocspUrls: string[]
  caIssuers: string[]
  crlUrls: string[]
  certificatePolicies: string[]

  // Chain
  chain: ChainEntry[]

  // Raw PEM for download
  pem: string
}

export type CertCheckerResponse =
  | { ok: true; certificate: ParsedCertificate; keyMatch?: boolean }
  | { ok: false; error: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dnFromForgeCert(dn: forge.pki.Certificate['subject']): string {
  return dn.attributes
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${a.value}`)
    .join(', ')
}

function getAttr(dn: forge.pki.Certificate['subject'], name: string): string {
  return (dn.getField(name)?.value as string | undefined) ?? ''
}

function colonHex(buf: string): string {
  return buf.match(/.{1,2}/g)?.join(':') ?? buf
}

function parseForgeCert(forgeCert: forge.pki.Certificate, pemStr: string): ParsedCertificate {
  const now = new Date()
  const notAfter = forgeCert.validity.notAfter
  const notBefore = forgeCert.validity.notBefore
  const msRemaining = notAfter.getTime() - now.getTime()
  const daysRemaining = Math.floor(msRemaining / 86_400_000)
  const isSelfSigned = forgeCert.isIssuer(forgeCert)

  // Fingerprints via forge
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(forgeCert)).getBytes()
  const sha1 = colonHex(
    forge.md.sha1.create().update(derBytes).digest().toHex()
  )
  const sha256 = colonHex(
    forge.md.sha256.create().update(derBytes).digest().toHex()
  )

  // Node crypto for SHA-512 fingerprint
  const derBuf = Buffer.from(derBytes, 'binary')
  const sha512 = crypto.createHash('sha512').update(derBuf).digest('hex')
    .match(/.{1,2}/g)!.join(':')

  // Key info
  let keyAlgorithm = 'Unknown'
  let keySize: number | null = null
  let curve: string | null = null

  const pubKey = forgeCert.publicKey as forge.pki.rsa.PublicKey & { curve?: string; n?: forge.jsbn.BigInteger }
  if ('n' in pubKey && pubKey.n) {
    keyAlgorithm = 'RSA'
    keySize = pubKey.n.bitLength()
  } else if ('curve' in pubKey) {
    keyAlgorithm = 'EC'
    curve = (pubKey as unknown as { curve: string }).curve ?? null
  } else {
    // Check OID from siginfo
    const sigAlg = (forgeCert as unknown as { signatureOid: string }).signatureOid
    if (sigAlg?.startsWith('1.2.840.10045')) {
      keyAlgorithm = 'EC'
    } else if (sigAlg?.startsWith('1.3.101')) {
      keyAlgorithm = 'EdDSA'
    }
  }

  // Signature algorithm
  const sigAlgName = (forgeCert.siginfo as unknown as { algorithmOid: string })?.algorithmOid ?? ''
  const sigAlgMap: Record<string, string> = {
    '1.2.840.113549.1.1.5':  'SHA1withRSA',
    '1.2.840.113549.1.1.11': 'SHA256withRSA',
    '1.2.840.113549.1.1.12': 'SHA384withRSA',
    '1.2.840.113549.1.1.13': 'SHA512withRSA',
    '1.2.840.10045.4.3.2':   'SHA256withECDSA',
    '1.2.840.10045.4.3.3':   'SHA384withECDSA',
    '1.2.840.10045.4.3.4':   'SHA512withECDSA',
    '1.3.101.112':           'Ed25519',
  }
  const signatureAlgorithm = sigAlgMap[sigAlgName] ?? (forgeCert as unknown as { signatureAlgorithm?: string }).signatureAlgorithm ?? sigAlgName

  // SANs
  const sans: ParsedSAN[] = []
  const sanExt = forgeCert.getExtension('subjectAltName') as
    | { altNames: Array<{ type: number; value?: string; ip?: string }> }
    | null
  if (sanExt) {
    for (const alt of sanExt.altNames) {
      const typeMap: Record<number, string> = {
        1: 'email', 2: 'DNS', 6: 'URI', 7: 'IP',
      }
      sans.push({ type: typeMap[alt.type] ?? `type${alt.type}`, value: alt.value ?? alt.ip ?? '' })
    }
  }

  // Key usage
  const keyUsage: string[] = []
  const kuExt = forgeCert.getExtension('keyUsage') as Record<string, boolean> | null
  if (kuExt) {
    const kuNames: [string, string][] = [
      ['digitalSignature', 'Digital Signature'],
      ['nonRepudiation', 'Non Repudiation'],
      ['keyEncipherment', 'Key Encipherment'],
      ['dataEncipherment', 'Data Encipherment'],
      ['keyAgreement', 'Key Agreement'],
      ['keyCertSign', 'Certificate Sign'],
      ['cRLSign', 'CRL Sign'],
      ['encipherOnly', 'Encipher Only'],
      ['decipherOnly', 'Decipher Only'],
    ]
    for (const [key, label] of kuNames) {
      if (kuExt[key]) keyUsage.push(label)
    }
  }

  // Extended key usage
  const extendedKeyUsage: string[] = []
  const ekuExt = forgeCert.getExtension('extKeyUsage') as Record<string, boolean> | null
  if (ekuExt) {
    const ekuNames: [string, string][] = [
      ['serverAuth', 'TLS Web Server Authentication'],
      ['clientAuth', 'TLS Web Client Authentication'],
      ['codeSigning', 'Code Signing'],
      ['emailProtection', 'Email Protection'],
      ['timeStamping', 'Time Stamping'],
      ['OCSPSigning', 'OCSP Signing'],
    ]
    for (const [key, label] of ekuNames) {
      if (ekuExt[key]) extendedKeyUsage.push(label)
    }
  }

  // Basic constraints
  let isCA = false
  let pathLength: number | null = null
  const bcExt = forgeCert.getExtension('basicConstraints') as
    | { cA: boolean; pathLenConstraint?: number }
    | null
  if (bcExt) {
    isCA = bcExt.cA ?? false
    pathLength = bcExt.pathLenConstraint ?? null
  }

  // Subject/Authority key identifiers
  const skiExt = forgeCert.getExtension('subjectKeyIdentifier') as { subjectKeyIdentifier?: string } | null
  const akiExt = forgeCert.getExtension('authorityKeyIdentifier') as { keyIdentifier?: string } | null
  const subjectKeyId = skiExt?.subjectKeyIdentifier
    ? colonHex(forge.util.bytesToHex(skiExt.subjectKeyIdentifier))
    : null
  const authorityKeyId = akiExt?.keyIdentifier
    ? colonHex(forge.util.bytesToHex(akiExt.keyIdentifier))
    : null

  // Authority Info Access (OCSP + CA issuers)
  const ocspUrls: string[] = []
  const caIssuers: string[] = []
  const aiaExt = forgeCert.getExtension('authorityInfoAccessSyntax') as
    | { accessDescriptions: Array<{ accessMethod: string; accessLocation: { value: string } }> }
    | null
  if (aiaExt) {
    for (const desc of aiaExt.accessDescriptions) {
      if (desc.accessMethod === '1.3.6.1.5.5.7.48.1') ocspUrls.push(desc.accessLocation.value)
      if (desc.accessMethod === '1.3.6.1.5.5.7.48.2') caIssuers.push(desc.accessLocation.value)
    }
  }

  // CRL Distribution Points
  const crlUrls: string[] = []
  const crlExt = forgeCert.getExtension('cRLDistributionPoints') as
    | { distributionPoints?: Array<{ distributionPoint?: { value?: Array<{ value?: string }> } }> }
    | null
  if (crlExt?.distributionPoints) {
    for (const dp of crlExt.distributionPoints) {
      const uri = dp.distributionPoint?.value?.[0]?.value
      if (uri) crlUrls.push(uri)
    }
  }

  // Certificate policies
  const certificatePolicies: string[] = []
  const cpExt = forgeCert.getExtension('certificatePolicies') as
    | { policies?: Array<{ policyIdentifier: string }> }
    | null
  if (cpExt?.policies) {
    for (const policy of cpExt.policies) {
      certificatePolicies.push(policy.policyIdentifier)
    }
  }

  return {
    subject: dnFromForgeCert(forgeCert.subject),
    commonName: getAttr(forgeCert.subject, 'CN'),
    organization: getAttr(forgeCert.subject, 'O'),
    organizationalUnit: getAttr(forgeCert.subject, 'OU'),
    country: getAttr(forgeCert.subject, 'C'),
    state: getAttr(forgeCert.subject, 'ST'),
    locality: getAttr(forgeCert.subject, 'L'),
    issuer: dnFromForgeCert(forgeCert.issuer),
    issuerCommonName: getAttr(forgeCert.issuer, 'CN'),
    issuerOrganization: getAttr(forgeCert.issuer, 'O'),
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    daysRemaining,
    isExpired: daysRemaining < 0,
    isExpiringSoon: daysRemaining >= 0 && daysRemaining <= 30,
    serialNumber: colonHex(forgeCert.serialNumber),
    fingerprintSha1: sha1,
    fingerprintSha256: sha256,
    fingerprintSha512: sha512,
    isSelfSigned,
    keyAlgorithm,
    keySize,
    curve,
    signatureAlgorithm,
    sans,
    keyUsage,
    extendedKeyUsage,
    isCA,
    pathLength,
    subjectKeyId,
    authorityKeyId,
    ocspUrls,
    caIssuers,
    crlUrls,
    certificatePolicies,
    chain: [], // populated by caller if needed
    pem: pemStr,
  }
}

/** Convert any supported format to an array of PEM strings */
function toPemArray(input: Buffer, password?: string): string[] {
  const pems: string[] = []

  // Try PEM text first
  const text = input.toString('utf8')
  if (text.includes('-----BEGIN')) {
    // May contain multiple certs (bundle)
    const matches = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (matches && matches.length > 0) return matches.map((m) => m.trim())
    // PKCS#7 in PEM form
    if (text.includes('BEGIN PKCS7') || text.includes('BEGIN CERTIFICATE REQUEST')) {
      return parsePkcs7Pem(text)
    }
  }

  // Try DER / PKCS#7 DER
  try {
    const asn1 = forge.asn1.fromDer(input.toString('binary'))
    const content = asn1.value
    // Check if it looks like a PKCS#7 (sequence with OID 1.2.840.113549.1.7.*)
    if (Array.isArray(content) && content.length >= 1) {
      // Attempt PKCS#7
      try {
        const p7 = forge.pkcs7.messageFromAsn1(asn1)
        if ('certificates' in p7 && Array.isArray(p7.certificates)) {
          return (p7.certificates as forge.pki.Certificate[]).map(forge.pki.certificateToPem)
        }
      } catch { /* not PKCS#7 */ }
      // Attempt raw DER certificate
      try {
        const cert = forge.pki.certificateFromAsn1(asn1)
        pems.push(forge.pki.certificateToPem(cert))
        return pems
      } catch { /* not a certificate */ }
    }
  } catch { /* not valid DER */ }

  // Try PKCS#12
  if (password !== undefined) {
    try {
      const p12Asn1 = forge.asn1.fromDer(input.toString('binary'))
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password)
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
      const bags = certBags[forge.pki.oids.certBag as string] ?? []
      for (const bag of bags) {
        if (bag.cert) pems.push(forge.pki.certificateToPem(bag.cert))
      }
      if (pems.length > 0) return pems
    } catch { /* wrong password or not PKCS#12 */ }
  }

  throw new Error('Unable to parse certificate — unsupported format or wrong password')
}

function parsePkcs7Pem(text: string): string[] {
  const match = text.match(/-----BEGIN PKCS7-----[\s\S]+?-----END PKCS7-----/)
  if (!match) return []
  const der = forge.util.decode64(
    match[0].replace('-----BEGIN PKCS7-----', '').replace('-----END PKCS7-----', '').replace(/\s/g, '')
  )
  const asn1 = forge.asn1.fromDer(der)
  const p7 = forge.pkcs7.messageFromAsn1(asn1)
  if ('certificates' in p7 && Array.isArray(p7.certificates)) {
    return (p7.certificates as forge.pki.Certificate[]).map(forge.pki.certificateToPem)
  }
  return []
}

function fetchCertFromUrl(hostname: string, port: number, servername: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port, servername, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        const peerCert = socket.getPeerCertificate(true)
        socket.end()
        if (!peerCert || !peerCert.raw) {
          return reject(new Error('No certificate received from server'))
        }
        const pems: string[] = []
        let current: tls.DetailedPeerCertificate | null = peerCert
        const seen = new Set<string>()
        while (current && current.raw && !seen.has(current.fingerprint256)) {
          seen.add(current.fingerprint256)
          const b64 = current.raw.toString('base64').match(/.{1,64}/g)!.join('\n')
          pems.push(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`)
          if (current.issuerCertificate === current) break
          current = current.issuerCertificate as tls.DetailedPeerCertificate | null
        }
        resolve(pems)
      }
    )
    socket.on('error', reject)
    socket.setTimeout(10_000, () => {
      socket.destroy()
      reject(new Error('Connection timed out'))
    })
  })
}

function pemToForgeCert(pem: string): forge.pki.Certificate {
  return forge.pki.certificateFromPem(pem)
}

function buildChain(forgeCerts: forge.pki.Certificate[]): ChainEntry[] {
  return forgeCerts.map((c) => {
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes()
    const sha256 = colonHex(forge.md.sha256.create().update(derBytes).digest().toHex())
    const bcExt = c.getExtension('basicConstraints') as { cA?: boolean } | null
    return {
      subject: dnFromForgeCert(c.subject),
      issuer: dnFromForgeCert(c.issuer),
      notBefore: c.validity.notBefore.toISOString(),
      notAfter: c.validity.notAfter.toISOString(),
      fingerprintSha256: sha256,
      isCA: bcExt?.cA ?? false,
    }
  })
}

// ─── Key match helper ─────────────────────────────────────────────────────────

function checkKeyMatch(keyPem: string, certPem: string): boolean {
  try {
    const privKey = crypto.createPrivateKey(keyPem)
    const x509 = new crypto.X509Certificate(certPem)
    return x509.checkPrivateKey(privKey)
  } catch {
    return false
  }
}

// ─── Request schemas ───────────────────────────────────────────────────────────

const ParseBodySchema = z.object({
  action: z.literal('parse'),
  data: z.string().optional(),       // base64-encoded binary file
  pemText: z.string().optional(),    // direct PEM/text paste
  password: z.string().optional(),
  keyPem: z.string().optional(),
}).refine((v) => v.data != null || v.pemText != null, {
  message: 'Either data or pemText is required',
})

const FetchUrlBodySchema = z.object({
  action: z.literal('fetch-url'),
  url: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  servername: z.string().optional(),
  keyPem: z.string().optional(),
})

const ValidateKeyBodySchema = z.object({
  action: z.literal('validate-key'),
  certPem: z.string().min(1),
  keyPem: z.string().min(1),
})

const DownloadBodySchema = z.object({
  action: z.literal('download'),
  certPem: z.string().min(1),
  format: z.enum(['pem', 'der', 'pkcs7']),
})

const BodySchema = z.discriminatedUnion('action', [
  ParseBodySchema,
  FetchUrlBodySchema,
  ValidateKeyBodySchema,
  DownloadBodySchema,
])

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const data = parsed.data

  try {
    // ── Parse uploaded file or pasted PEM ───────────────────────────────────
    if (data.action === 'parse') {
      const buf = data.pemText
        ? Buffer.from(data.pemText, 'utf8')
        : Buffer.from(data.data!, 'base64')
      const pems = toPemArray(buf, data.password)
      const forgeCerts = pems.map(pemToForgeCert)
      const chain = forgeCerts.length > 1 ? buildChain(forgeCerts) : []
      const cert = parseForgeCert(forgeCerts[0]!, pems[0]!)
      cert.chain = chain
      const keyMatch = data.keyPem ? checkKeyMatch(data.keyPem, pems[0]!) : undefined
      return NextResponse.json({ ok: true, certificate: cert, keyMatch } satisfies CertCheckerResponse)
    }

    // ── Fetch from URL ───────────────────────────────────────────────────────
    if (data.action === 'fetch-url') {
      let hostname = data.url.trim()
      hostname = hostname.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
      const port = data.port ?? 443
      const servername = data.servername ?? hostname
      const pems = await fetchCertFromUrl(hostname, port, servername)
      const forgeCerts = pems.map(pemToForgeCert)
      const chain = forgeCerts.length > 1 ? buildChain(forgeCerts) : []
      const cert = parseForgeCert(forgeCerts[0]!, pems[0]!)
      cert.chain = chain
      const keyMatch = data.keyPem ? checkKeyMatch(data.keyPem, pems[0]!) : undefined
      return NextResponse.json({ ok: true, certificate: cert, keyMatch } satisfies CertCheckerResponse)
    }

    // ── Validate key matches cert ────────────────────────────────────────────
    if (data.action === 'validate-key') {
      let privKey: crypto.KeyObject
      try {
        privKey = crypto.createPrivateKey(data.keyPem)
      } catch {
        return NextResponse.json({ ok: false, error: 'Unable to parse private key — check format and passphrase' }, { status: 400 })
      }

      let x509: crypto.X509Certificate
      try {
        x509 = new crypto.X509Certificate(data.certPem)
      } catch {
        return NextResponse.json({ ok: false, error: 'Unable to parse certificate PEM' }, { status: 400 })
      }

      const keyMatch = x509.checkPrivateKey(privKey)
      return NextResponse.json({ ok: true, certificate: null as unknown as ParsedCertificate, keyMatch })
    }

    // ── Download / convert format ────────────────────────────────────────────
    if (data.action === 'download') {
      const forgeCert = pemToForgeCert(data.certPem)

      if (data.format === 'pem') {
        return new NextResponse(data.certPem, {
          headers: { 'Content-Type': 'application/x-pem-file', 'Content-Disposition': 'attachment; filename="certificate.pem"' },
        })
      }

      if (data.format === 'der') {
        const asn1 = forge.pki.certificateToAsn1(forgeCert)
        const der = forge.asn1.toDer(asn1).getBytes()
        const buf = Buffer.from(der, 'binary')
        return new NextResponse(buf, {
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="certificate.der"' },
        })
      }

      if (data.format === 'pkcs7') {
        const p7 = forge.pkcs7.createSignedData()
        p7.addCertificate(forgeCert)
        const asn1 = (p7 as unknown as { toAsn1: () => forge.asn1.Asn1 }).toAsn1()
        const derStr = forge.asn1.toDer(asn1).getBytes()
        const b64 = forge.util.encode64(derStr).match(/.{1,64}/g)!.join('\n')
        const p7pem = `-----BEGIN PKCS7-----\n${b64}\n-----END PKCS7-----\n`
        return new NextResponse(p7pem, {
          headers: { 'Content-Type': 'application/x-pkcs7-certificates', 'Content-Disposition': 'attachment; filename="certificate.p7b"' },
        })
      }
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
