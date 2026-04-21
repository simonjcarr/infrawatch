import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import * as forge from 'node-forge'
import { z } from 'zod'
import {
  type ParsedCertificate,
  checkKeyMatch,
  fetchCertificateFromUrl,
  parseCertificateBuffer,
  pemToForgeCert,
  resolveUrlTarget,
} from '@/lib/certificates/fetch'
import { assertPublicHost } from '@/lib/net/ssrf-guard'

export type { ParsedCertificate, ParsedSAN, ChainEntry } from '@/lib/certificates/fetch'

export type CertCheckerResponse =
  | { ok: true; certificate: ParsedCertificate; keyMatch?: boolean }
  | { ok: false; error: string }

const ParseBodySchema = z.object({
  action: z.literal('parse'),
  data: z.string().optional(),
  pemText: z.string().optional(),
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
    if (data.action === 'parse') {
      const buf = data.pemText
        ? Buffer.from(data.pemText, 'utf8')
        : Buffer.from(data.data!, 'base64')
      const cert = parseCertificateBuffer(buf, data.password)
      const keyMatch = data.keyPem ? checkKeyMatch(data.keyPem, cert.pem) : undefined
      return NextResponse.json({ ok: true, certificate: cert, keyMatch } satisfies CertCheckerResponse)
    }

    if (data.action === 'fetch-url') {
      const { host } = resolveUrlTarget(data.url, data.port)
      await assertPublicHost(host)
      const { certificate } = await fetchCertificateFromUrl(data.url, data.port, data.servername)
      const keyMatch = data.keyPem ? checkKeyMatch(data.keyPem, certificate.pem) : undefined
      return NextResponse.json({ ok: true, certificate, keyMatch } satisfies CertCheckerResponse)
    }

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
    console.error('[certificate-checker] Unexpected error:', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    // Expose the message only for operational errors whose text is explicitly user-friendly
    // (e.g. SSRF guard, size limit, parse failure). Avoid leaking raw stack traces.
    const isSafe =
      message.startsWith('Blocked:') ||
      message.startsWith('Server returned a certificate') ||
      message.startsWith('Unable to parse certificate') ||
      message.startsWith('Connection timed out') ||
      message.startsWith('No certificate received')
    return NextResponse.json(
      { ok: false, error: isSafe ? message : 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
