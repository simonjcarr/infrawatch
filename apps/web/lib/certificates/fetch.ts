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

interface DerNode {
  tag: number
  length: number
  headerLength: number
  start: number
  valueStart: number
  valueEnd: number
  end: number
}

interface ParsedDistinguishedName {
  formatted: string
  attrs: Record<string, string>
}

function colonHex(buf: string): string {
  return buf.match(/.{1,2}/g)?.join(':') ?? buf
}

function normalizeHex(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
}

function formatSerialNumber(value: string): string {
  return colonHex(normalizeHex(value))
}

function ensureValidBufferLength(buf: Buffer, context: string): void {
  if (buf.length === 0) {
    throw new Error(`Unable to parse certificate — empty ${context}`)
  }
  if (buf.length > MAX_CERT_BYTES) {
    throw new Error(`Unable to parse certificate — ${context} exceeds the ${MAX_CERT_BYTES}-byte size limit`)
  }
}

function readDerNode(buf: Buffer, offset: number): DerNode {
  if (offset >= buf.length) throw new Error('Invalid DER: truncated tag')
  const tag = buf[offset]!
  const firstLengthByte = buf[offset + 1]
  if (firstLengthByte === undefined) throw new Error('Invalid DER: truncated length')

  let length = 0
  let headerLength = 2
  if ((firstLengthByte & 0x80) === 0) {
    length = firstLengthByte
  } else {
    const lengthByteCount = firstLengthByte & 0x7f
    if (lengthByteCount === 0) throw new Error('Invalid DER: indefinite length')
    if (lengthByteCount > 4) throw new Error('Invalid DER: unsupported length')
    if (offset + 2 + lengthByteCount > buf.length) throw new Error('Invalid DER: truncated long length')
    headerLength += lengthByteCount
    for (let i = 0; i < lengthByteCount; i += 1) {
      length = (length << 8) | buf[offset + 2 + i]!
    }
  }

  const valueStart = offset + headerLength
  const valueEnd = valueStart + length
  if (valueEnd > buf.length) throw new Error('Invalid DER: truncated value')

  return {
    tag,
    length,
    headerLength,
    start: offset,
    valueStart,
    valueEnd,
    end: valueEnd,
  }
}

function getDerChildren(buf: Buffer, node: DerNode): DerNode[] {
  const children: DerNode[] = []
  let offset = node.valueStart
  while (offset < node.valueEnd) {
    const child = readDerNode(buf, offset)
    children.push(child)
    offset = child.end
  }
  if (offset !== node.valueEnd) throw new Error('Invalid DER: child parsing did not consume parent value')
  return children
}

function decodeDerOid(bytes: Buffer): string {
  if (bytes.length === 0) return ''
  const first = bytes[0]!
  const parts = [Math.floor(first / 40), first % 40]
  let value = 0
  for (let i = 1; i < bytes.length; i += 1) {
    const byte = bytes[i]!
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

function decodeDerString(tag: number, bytes: Buffer): string {
  switch (tag) {
    case 0x0c:
    case 0x12:
    case 0x13:
    case 0x14:
    case 0x16:
    case 0x17:
    case 0x18:
    case 0x1a:
      return bytes.toString('utf8')
    case 0x1e: {
      const chars: string[] = []
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        chars.push(String.fromCharCode(bytes.readUInt16BE(i)))
      }
      return chars.join('')
    }
    default:
      return bytes.toString('utf8')
  }
}

function parseDistinguishedName(raw: string): ParsedDistinguishedName {
  const attrs: Record<string, string> = {}
  const parts = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (!(key in attrs)) attrs[key] = value
  }

  return {
    formatted: parts.join(', '),
    attrs,
  }
}

function parseSubjectAltName(raw: string | undefined): ParsedSAN[] {
  if (!raw) return []
  const segments = raw
    .split(/,(?=\s*(?:DNS|IP Address|URI|email|othername|DirName|Registered ID):)/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return segments.flatMap((segment) => {
    const idx = segment.indexOf(':')
    if (idx <= 0) return []
    const type = segment.slice(0, idx).trim()
    const value = segment.slice(idx + 1).trim()
    const normalizedType = type === 'IP Address' ? 'IP' : type
    return [{ type: normalizedType, value }]
  })
}

function ipBytesToString(bytes: Buffer): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length !== 16) return bytes.toString('hex')
  const groups: string[] = []
  for (let i = 0; i < bytes.length; i += 2) {
    groups.push(bytes.readUInt16BE(i).toString(16))
  }
  return groups.join(':').replace(/\b:?(?:0+:){2,}/, '::')
}

function extractExtensionInfo(rawDer: Buffer): {
  signatureAlgorithm: string
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
  sans: ParsedSAN[]
} {
  const signatureAlgorithmMap: Record<string, string> = {
    '1.2.840.113549.1.1.5': 'SHA1withRSA',
    '1.2.840.113549.1.1.11': 'SHA256withRSA',
    '1.2.840.113549.1.1.12': 'SHA384withRSA',
    '1.2.840.113549.1.1.13': 'SHA512withRSA',
    '1.2.840.10045.4.3.2': 'SHA256withECDSA',
    '1.2.840.10045.4.3.3': 'SHA384withECDSA',
    '1.2.840.10045.4.3.4': 'SHA512withECDSA',
    '1.3.101.112': 'Ed25519',
    '1.3.101.113': 'Ed448',
  }
  const keyUsageLabels = [
    'Digital Signature',
    'Non Repudiation',
    'Key Encipherment',
    'Data Encipherment',
    'Key Agreement',
    'Certificate Sign',
    'CRL Sign',
    'Encipher Only',
    'Decipher Only',
  ]
  const extendedKeyUsageMap: Record<string, string> = {
    '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
    '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
    '1.3.6.1.5.5.7.3.3': 'Code Signing',
    '1.3.6.1.5.5.7.3.4': 'Email Protection',
    '1.3.6.1.5.5.7.3.8': 'Time Stamping',
    '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  }

  const parsed = {
    signatureAlgorithm: 'Unknown',
    keyUsage: [] as string[],
    extendedKeyUsage: [] as string[],
    isCA: false,
    pathLength: null as number | null,
    subjectKeyId: null as string | null,
    authorityKeyId: null as string | null,
    ocspUrls: [] as string[],
    caIssuers: [] as string[],
    crlUrls: [] as string[],
    certificatePolicies: [] as string[],
    sans: [] as ParsedSAN[],
  }

  const certNode = readDerNode(rawDer, 0)
  const certChildren = getDerChildren(rawDer, certNode)
  const signatureNode = certChildren[1]
  if (signatureNode) {
    const signatureChildren = getDerChildren(rawDer, signatureNode)
    const oidNode = signatureChildren[0]
    if (oidNode?.tag === 0x06) {
      const signatureOid = decodeDerOid(rawDer.subarray(oidNode.valueStart, oidNode.valueEnd))
      parsed.signatureAlgorithm = signatureAlgorithmMap[signatureOid] ?? signatureOid
    }
  }

  const tbsNode = certChildren[0]
  if (!tbsNode) return parsed
  for (const child of getDerChildren(rawDer, tbsNode)) {
    if (child.tag !== 0xa3) continue
    const extensionContainer = getDerChildren(rawDer, child)[0]
    if (!extensionContainer) continue
    for (const extNode of getDerChildren(rawDer, extensionContainer)) {
      const extChildren = getDerChildren(rawDer, extNode)
      const oidNode = extChildren[0]
      const valueNode = extChildren[extChildren.length - 1]
      if (!oidNode || !valueNode || oidNode.tag !== 0x06 || valueNode.tag !== 0x04) continue
      const oid = decodeDerOid(rawDer.subarray(oidNode.valueStart, oidNode.valueEnd))
      const extValue = rawDer.subarray(valueNode.valueStart, valueNode.valueEnd)
      if (extValue.length === 0) continue
      const root = readDerNode(extValue, 0)

      if (oid === '2.5.29.15' && root.tag === 0x03) {
        const bitString = extValue.subarray(root.valueStart + 1, root.valueEnd)
        for (let i = 0; i < keyUsageLabels.length; i += 1) {
          const byteIndex = Math.floor(i / 8)
          const bitIndex = 7 - (i % 8)
          if (byteIndex < bitString.length && ((bitString[byteIndex]! >> bitIndex) & 1) === 1) {
            parsed.keyUsage.push(keyUsageLabels[i]!)
          }
        }
        continue
      }

      if (oid === '2.5.29.37' && root.tag === 0x30) {
        for (const usageNode of getDerChildren(extValue, root)) {
          if (usageNode.tag !== 0x06) continue
          const usageOid = decodeDerOid(extValue.subarray(usageNode.valueStart, usageNode.valueEnd))
          parsed.extendedKeyUsage.push(extendedKeyUsageMap[usageOid] ?? usageOid)
        }
        continue
      }

      if (oid === '2.5.29.19' && root.tag === 0x30) {
        for (const bcNode of getDerChildren(extValue, root)) {
          if (bcNode.tag === 0x01) {
            parsed.isCA = extValue[bcNode.valueStart] === 0xff
          } else if (bcNode.tag === 0x02) {
            parsed.pathLength = extValue.readUIntBE(bcNode.valueStart, bcNode.length)
          }
        }
        continue
      }

      if (oid === '2.5.29.14' && root.tag === 0x04) {
        parsed.subjectKeyId = colonHex(extValue.subarray(root.valueStart, root.valueEnd).toString('hex').toUpperCase())
        continue
      }

      if (oid === '2.5.29.35' && root.tag === 0x30) {
        for (const akiNode of getDerChildren(extValue, root)) {
          if (akiNode.tag === 0x80) {
            parsed.authorityKeyId = colonHex(extValue.subarray(akiNode.valueStart, akiNode.valueEnd).toString('hex').toUpperCase())
          }
        }
        continue
      }

      if (oid === '2.5.29.32' && root.tag === 0x30) {
        for (const policyNode of getDerChildren(extValue, root)) {
          const children = getDerChildren(extValue, policyNode)
          const policyOidNode = children[0]
          if (policyOidNode?.tag === 0x06) {
            parsed.certificatePolicies.push(decodeDerOid(extValue.subarray(policyOidNode.valueStart, policyOidNode.valueEnd)))
          }
        }
        continue
      }

      if (oid === '2.5.29.17' && root.tag === 0x30) {
        for (const sanNode of getDerChildren(extValue, root)) {
          if (sanNode.tag === 0x81) {
            parsed.sans.push({ type: 'email', value: extValue.subarray(sanNode.valueStart, sanNode.valueEnd).toString('utf8') })
          } else if (sanNode.tag === 0x82) {
            parsed.sans.push({ type: 'DNS', value: extValue.subarray(sanNode.valueStart, sanNode.valueEnd).toString('utf8') })
          } else if (sanNode.tag === 0x86) {
            parsed.sans.push({ type: 'URI', value: extValue.subarray(sanNode.valueStart, sanNode.valueEnd).toString('utf8') })
          } else if (sanNode.tag === 0x87) {
            parsed.sans.push({ type: 'IP', value: ipBytesToString(extValue.subarray(sanNode.valueStart, sanNode.valueEnd)) })
          }
        }
        continue
      }

      if (oid === '1.3.6.1.5.5.7.1.1' && root.tag === 0x30) {
        for (const accessNode of getDerChildren(extValue, root)) {
          const children = getDerChildren(extValue, accessNode)
          const methodNode = children[0]
          const locationNode = children[1]
          if (methodNode?.tag !== 0x06 || locationNode?.tag !== 0x86) continue
          const accessMethod = decodeDerOid(extValue.subarray(methodNode.valueStart, methodNode.valueEnd))
          const location = extValue.subarray(locationNode.valueStart, locationNode.valueEnd).toString('utf8')
          if (accessMethod === '1.3.6.1.5.5.7.48.1') parsed.ocspUrls.push(location)
          if (accessMethod === '1.3.6.1.5.5.7.48.2') parsed.caIssuers.push(location)
        }
        continue
      }

      if (oid === '2.5.29.31' && root.tag === 0x30) {
        for (const distributionPointNode of getDerChildren(extValue, root)) {
          for (const dpChild of getDerChildren(extValue, distributionPointNode)) {
            if (dpChild.tag !== 0xa0) continue
            for (const nameNode of getDerChildren(extValue, dpChild)) {
              if (nameNode.tag !== 0xa0) continue
              for (const generalNameNode of getDerChildren(extValue, nameNode)) {
                if (generalNameNode.tag === 0x86) {
                  parsed.crlUrls.push(extValue.subarray(generalNameNode.valueStart, generalNameNode.valueEnd).toString('utf8'))
                }
              }
            }
          }
        }
      }
    }
  }

  return parsed
}

function parseCertPem(pemStr: string): ParsedCertificate {
  const x509 = new crypto.X509Certificate(pemStr)
  ensureValidBufferLength(x509.raw, 'certificate')
  const now = new Date()
  const notAfter = new Date(x509.validTo)
  const notBefore = new Date(x509.validFrom)
  const msRemaining = notAfter.getTime() - now.getTime()
  const daysRemaining = Math.floor(msRemaining / 86_400_000)
  const isSelfSigned = x509.checkIssued(x509)
  const subject = parseDistinguishedName(x509.subject)
  const issuer = parseDistinguishedName(x509.issuer)
  const extensionInfo = extractExtensionInfo(x509.raw)
  const sans = extensionInfo.sans.length > 0 ? extensionInfo.sans : parseSubjectAltName(x509.subjectAltName)

  let keyAlgorithm = 'Unknown'
  let keySize: number | null = null
  let curve: string | null = null

  const publicKey = x509.publicKey
  if (publicKey.asymmetricKeyType === 'rsa') {
    keyAlgorithm = 'RSA'
    keySize = publicKey.asymmetricKeyDetails?.modulusLength ?? null
  } else if (publicKey.asymmetricKeyType === 'ec') {
    keyAlgorithm = 'EC'
    curve = publicKey.asymmetricKeyDetails?.namedCurve ?? null
    keySize = publicKey.asymmetricKeyDetails?.modulusLength ?? null
  } else if (publicKey.asymmetricKeyType === 'ed25519') {
    keyAlgorithm = 'Ed25519'
  } else if (publicKey.asymmetricKeyType === 'ed448') {
    keyAlgorithm = 'Ed448'
  } else {
    keyAlgorithm = publicKey.asymmetricKeyType ?? 'Unknown'
  }

  return {
    subject: subject.formatted,
    commonName: subject.attrs.CN ?? '',
    organization: subject.attrs.O ?? '',
    organizationalUnit: subject.attrs.OU ?? '',
    country: subject.attrs.C ?? '',
    state: subject.attrs.ST ?? '',
    locality: subject.attrs.L ?? '',
    issuer: issuer.formatted,
    issuerCommonName: issuer.attrs.CN ?? '',
    issuerOrganization: issuer.attrs.O ?? '',
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    daysRemaining,
    isExpired: daysRemaining < 0,
    isExpiringSoon: daysRemaining >= 0 && daysRemaining <= 30,
    serialNumber: formatSerialNumber(x509.serialNumber),
    fingerprintSha256: x509.fingerprint256,
    fingerprintSha512: x509.fingerprint512,
    isSelfSigned,
    keyAlgorithm,
    keySize,
    curve,
    signatureAlgorithm: extensionInfo.signatureAlgorithm,
    sans,
    keyUsage: extensionInfo.keyUsage,
    extendedKeyUsage: extensionInfo.extendedKeyUsage,
    isCA: extensionInfo.isCA || x509.ca,
    pathLength: extensionInfo.pathLength,
    subjectKeyId: extensionInfo.subjectKeyId,
    authorityKeyId: extensionInfo.authorityKeyId,
    ocspUrls: extensionInfo.ocspUrls,
    caIssuers: extensionInfo.caIssuers,
    crlUrls: extensionInfo.crlUrls,
    certificatePolicies: extensionInfo.certificatePolicies,
    chain: [],
    pem: pemStr,
  }
}

export function buildChain(pems: string[]): ChainEntry[] {
  return pems.map((pem) => {
    const x509 = new crypto.X509Certificate(pem)
    const subject = parseDistinguishedName(x509.subject)
    const issuer = parseDistinguishedName(x509.issuer)
    const ext = extractExtensionInfo(x509.raw)
    return {
      subject: subject.formatted,
      issuer: issuer.formatted,
      notBefore: new Date(x509.validFrom).toISOString(),
      notAfter: new Date(x509.validTo).toISOString(),
      fingerprintSha256: x509.fingerprint256,
      isCA: ext.isCA || x509.ca,
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
    if (matches && matches.length > 0) {
      return matches.map((m) => {
        const trimmed = m.trim()
        ensureValidBufferLength(Buffer.from(trimmed, 'utf8'), 'certificate PEM')
        return trimmed
      })
    }
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
        ensureValidBufferLength(input, 'certificate DER')
        const cert = new crypto.X509Certificate(input)
        pems.push(cert.toString())
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

// 64 KB per cert is well above any real-world certificate; rejects degenerate TLS responses.
const MAX_CERT_BYTES = 65_536
// Practical PKI chains are ≤ 5; cap at 10 to prevent memory exhaustion from crafted loops.
const MAX_CHAIN_DEPTH = 10

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
          if (current.raw.length > MAX_CERT_BYTES) {
            return reject(new Error(`Server returned a certificate exceeding the ${MAX_CERT_BYTES}-byte size limit`))
          }
          if (seen.size >= MAX_CHAIN_DEPTH) break
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
  const chain = pems.length > 1 ? buildChain(pems) : []
  const certificate = parseCertPem(pems[0]!)
  certificate.chain = chain
  return { certificate, host, port, serverName }
}

export function parseCertificateBuffer(input: Buffer, password?: string): ParsedCertificate {
  const pems = toPemArray(input, password)
  const chain = pems.length > 1 ? buildChain(pems) : []
  const cert = parseCertPem(pems[0]!)
  cert.chain = chain
  return cert
}
