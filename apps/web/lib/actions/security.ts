'use server'

import { readFile } from 'node:fs/promises'
import { createPublicKey, X509Certificate } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { certificateAuthorities } from '@/lib/db/schema/certificate-authorities'
import { encrypt } from '@/lib/crypto/encrypt'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import type { SecurityOverview } from './security-types'

async function requireAdmin(): Promise<void> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error('forbidden: admin role required')
  }
}

const SERVER_TLS_CERT_PATH = process.env['INGEST_TLS_CERT'] ?? '/etc/ct-ops/tls/server.crt'

export async function getSecurityOverview(): Promise<SecurityOverview | { error: string }> {
  try {
    await requireAdmin()

    let serverTls: SecurityOverview['serverTls'] = null
    try {
      const pem = await readFile(SERVER_TLS_CERT_PATH, 'utf-8')
      const cert = new X509Certificate(pem)
      serverTls = {
        certFile: SERVER_TLS_CERT_PATH,
        subject: cert.subject,
        issuer: cert.issuer,
        notBefore: cert.validFrom,
        notAfter: cert.validTo,
        fingerprintSha256: cert.fingerprint256.replace(/:/g, '').toLowerCase(),
      }
    } catch {
      // File may not be readable from the web container — that's fine, the
      // admin UI surfaces "unavailable" instead of erroring out.
    }

    const ca = await db.query.certificateAuthorities.findFirst({
      where: and(
        eq(certificateAuthorities.purpose, 'agent_ca'),
        isNull(certificateAuthorities.deletedAt),
      ),
      orderBy: [desc(certificateAuthorities.createdAt)],
    })

    let agentCa: SecurityOverview['agentCa'] = null
    if (ca) {
      const parsed = new X509Certificate(ca.certPem)
      agentCa = {
        source: ca.source,
        subject: parsed.subject,
        issuer: parsed.issuer,
        notBefore: parsed.validFrom,
        notAfter: parsed.validTo,
        fingerprintSha256: ca.fingerprintSha256,
        byoEnvConfigured: !!(process.env['INGEST_AGENT_CA_CERT'] && process.env['INGEST_AGENT_CA_KEY']),
      }
    }

    return { serverTls, agentCa }
  } catch (err) {
    console.error('getSecurityOverview failed:', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

const uploadSchema = z.object({
  certPem: z.string().min(1).max(32 * 1024),
  keyPem: z.string().min(1).max(32 * 1024),
})

export async function uploadAgentCA(
  input: z.infer<typeof uploadSchema>,
): Promise<{ success: true; fingerprint: string } | { error: string }> {
  try {
    await requireAdmin()
    const parsed = uploadSchema.parse(input)

    // Validate cert: parses, is a CA, still valid.
    let cert: X509Certificate
    try {
      cert = new X509Certificate(parsed.certPem)
    } catch (err) {
      return { error: `Invalid certificate PEM: ${err instanceof Error ? err.message : String(err)}` }
    }
    if (!cert.ca) {
      return { error: 'Uploaded certificate is not a CA (BasicConstraints CA flag not set).' }
    }
    if (new Date(cert.validTo) < new Date()) {
      return { error: 'Uploaded CA certificate has expired.' }
    }

    // Validate key matches cert.
    let matches = false
    try {
      const keyPub = createPublicKey(parsed.keyPem).export({ type: 'spki', format: 'pem' }).toString()
      const certPub = cert.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      matches = keyPub === certPub
    } catch (err) {
      return { error: `Invalid private key PEM: ${err instanceof Error ? err.message : String(err)}` }
    }
    if (!matches) {
      return { error: 'Private key does not match certificate public key.' }
    }

    const fingerprint = cert.fingerprint256.replace(/:/g, '').toLowerCase()
    const keyEncrypted = encrypt(parsed.keyPem)

    // Soft-delete any existing active CA so ingest builds the trust pool
    // with both the new and old CAs (overlap window).
    await db.transaction(async (tx) => {
      await tx
        .update(certificateAuthorities)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(certificateAuthorities.purpose, 'agent_ca'),
          isNull(certificateAuthorities.deletedAt),
        ))

      await tx.insert(certificateAuthorities).values({
        purpose: 'agent_ca',
        certPem: parsed.certPem,
        keyPemEncrypted: keyEncrypted,
        source: 'byo',
        fingerprintSha256: fingerprint,
        notBefore: new Date(cert.validFrom),
        notAfter: new Date(cert.validTo),
      })
    })

    return { success: true, fingerprint }
  } catch (err) {
    console.error('uploadAgentCA failed:', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

