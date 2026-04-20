import * as tls from 'tls'
import * as crypto from 'crypto'
import * as forge from 'node-forge'

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
  subject: string
  commonName: string
  organization: string
  organizationalUnit: string
  country: string
  state: string
  locality: string

  issuer: string
  issuerCommonName: string
  issuerOrganization: string

  notBefore: string
  notAfter: string
  daysRemaining: number
  isExpired: boolean
  isExpiringSoon: boolean

  serialNumber: string
  fingerprintSha256: string
  fingerprintSha512: string
  isSelfSigned: boolean

  keyAlgorithm: string
  keySize: number | null
  curve: string | null
  signatureAlgorithm: string

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

  chain: ChainEntry[]

  pem: string
}

export interface FetchUrlResult {
  certificate: ParsedCertificate
  host: string
  port: number
  serverName: string
}

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

export function pemToForgeCert(pem: string): forge.pki.Certificate {
  return forge.pki.certificateFromPem(pem)
}

export function parseForgeCert(forgeCert: forge.pki.Certificate, pemStr: string): ParsedCertificate {
  const now = new Date()
  const notAfter = forgeCert.validity.notAfter
  const notBefore = forgeCert.validity.notBefore
  const msRemaining = notAfter.getTime() - now.getTime()
  const daysRemaining = Math.floor(msRemaining / 86_400_000)
  const isSelfSigned = forgeCert.isIssuer(forgeCert)

  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(forgeCert)).getBytes()
  const sha256 = colonHex(
    forge.md.sha256.create().update(derBytes).digest().toHex()
  )

  const derBuf = Buffer.from(derBytes, 'binary')
  const sha512 = crypto.createHash('sha512').update(derBuf).digest('hex')
    .match(/.{1,2}/g)!.join(':')

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
    const sigAlg = (forgeCert as unknown as { signatureOid: string }).signatureOid
    if (sigAlg?.startsWith('1.2.840.10045')) {
      keyAlgorithm = 'EC'
    } else if (sigAlg?.startsWith('1.3.101')) {
      keyAlgorithm = 'EdDSA'
    }
  }

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

  let isCA = false
  let pathLength: number | null = null
  const bcExt = forgeCert.getExtension('basicConstraints') as
    | { cA: boolean; pathLenConstraint?: number }
    | null
  if (bcExt) {
    isCA = bcExt.cA ?? false
    pathLength = bcExt.pathLenConstraint ?? null
  }

  const skiExt = forgeCert.getExtension('subjectKeyIdentifier') as { subjectKeyIdentifier?: string } | null
  const akiExt = forgeCert.getExtension('authorityKeyIdentifier') as { keyIdentifier?: string } | null
  const subjectKeyId = skiExt?.subjectKeyIdentifier
    ? colonHex(forge.util.bytesToHex(skiExt.subjectKeyIdentifier))
    : null
  const authorityKeyId = akiExt?.keyIdentifier
    ? colonHex(forge.util.bytesToHex(akiExt.keyIdentifier))
    : null

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
    chain: [],
    pem: pemStr,
  }
}

export function buildChain(forgeCerts: forge.pki.Certificate[]): ChainEntry[] {
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

export function toPemArray(input: Buffer, password?: string): string[] {
  const pems: string[] = []

  const text = input.toString('utf8')
  if (text.includes('-----BEGIN')) {
    const matches = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (matches && matches.length > 0) return matches.map((m) => m.trim())
    if (text.includes('BEGIN PKCS7') || text.includes('BEGIN CERTIFICATE REQUEST')) {
      return parsePkcs7Pem(text)
    }
  }

  try {
    const asn1 = forge.asn1.fromDer(input.toString('binary'))
    const content = asn1.value
    if (Array.isArray(content) && content.length >= 1) {
      try {
        const p7 = forge.pkcs7.messageFromAsn1(asn1)
        if ('certificates' in p7 && Array.isArray(p7.certificates)) {
          return (p7.certificates as forge.pki.Certificate[]).map(forge.pki.certificateToPem)
        }
      } catch { /* not PKCS#7 */ }
      try {
        const cert = forge.pki.certificateFromAsn1(asn1)
        pems.push(forge.pki.certificateToPem(cert))
        return pems
      } catch { /* not a certificate */ }
    }
  } catch { /* not valid DER */ }

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

export function checkKeyMatch(keyPem: string, certPem: string): boolean {
  try {
    const privKey = crypto.createPrivateKey(keyPem)
    const x509 = new crypto.X509Certificate(certPem)
    return x509.checkPrivateKey(privKey)
  } catch {
    return false
  }
}

export interface ResolvedUrl {
  host: string
  port: number
  serverName: string
}

export function resolveUrlTarget(rawUrl: string, portOverride?: number, serverNameOverride?: string): ResolvedUrl {
  let host = rawUrl.trim()
  host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  // Strip :port if included in host portion
  const hostPortMatch = host.match(/^([^:]+)(?::(\d+))?$/)
  let extractedPort: number | undefined
  if (hostPortMatch) {
    host = hostPortMatch[1]!
    if (hostPortMatch[2]) extractedPort = parseInt(hostPortMatch[2], 10)
  }
  const port = portOverride ?? extractedPort ?? 443
  const serverName = serverNameOverride ?? host
  return { host, port, serverName }
}

export function fetchCertPemsFromUrl(host: string, port: number, serverName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: serverName, rejectUnauthorized: false, timeout: 10_000 },
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

export async function fetchCertificateFromUrl(
  rawUrl: string,
  portOverride?: number,
  serverNameOverride?: string,
): Promise<FetchUrlResult> {
  const { host, port, serverName } = resolveUrlTarget(rawUrl, portOverride, serverNameOverride)
  const pems = await fetchCertPemsFromUrl(host, port, serverName)
  const forgeCerts = pems.map(pemToForgeCert)
  const chain = forgeCerts.length > 1 ? buildChain(forgeCerts) : []
  const certificate = parseForgeCert(forgeCerts[0]!, pems[0]!)
  certificate.chain = chain
  return { certificate, host, port, serverName }
}

export function parseCertificateBuffer(input: Buffer, password?: string): ParsedCertificate {
  const pems = toPemArray(input, password)
  const forgeCerts = pems.map(pemToForgeCert)
  const chain = forgeCerts.length > 1 ? buildChain(forgeCerts) : []
  const cert = parseForgeCert(forgeCerts[0]!, pems[0]!)
  cert.chain = chain
  return cert
}
