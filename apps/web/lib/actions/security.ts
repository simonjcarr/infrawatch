'use server'

import { logError } from '@/lib/logging'
import { readFile } from 'node:fs/promises'
import { createPublicKey, X509Certificate } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { certificateAuthorities, instanceSettings } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto/encrypt'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { requireRole } from '@/lib/auth/guards'
import { assertAgentCAManagementAccess } from './security-auth'
import type { SecurityOverview } from './security-types'
import { isTwoFactorRequired } from '@/lib/auth/two-factor-policy'
import { parseInstanceMetadata, type InstanceSecuritySettings } from '@/lib/db/schema/instance-settings'

async function requireAdmin() {
  const session = await getRequiredSession()
  requireRole(session.user, ADMIN_ROLES)
  return session
}

async function requireAgentCAManager(): Promise<void> {
  const session = await getRequiredSession()
  assertAgentCAManagementAccess(session.user)
}

const SERVER_TLS_CERT_PATH = process.env['INGEST_TLS_CERT'] ?? '/etc/ct-ops/tls/server.crt'

export async function getSecurityOverview(): Promise<SecurityOverview | { error: string }> {
  try {
    const session = await requireAdmin()
    const instanceId = session.user.instanceId

    let accountAuth: SecurityOverview['accountAuth'] = { requireTwoFactor: false }
    if (instanceId) {
      const org = await db.query.instanceSettings.findFirst({
        where: eq(instanceSettings.id, instanceId),
        columns: { metadata: true },
      })
      accountAuth = {
        requireTwoFactor: isTwoFactorRequired(parseInstanceMetadata(org?.metadata)),
      }
    }

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

    return { accountAuth, serverTls, agentCa }
  } catch (err) {
    logError('getSecurityOverview failed:', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

const updateAccountAuthSchema = z.object({
  requireTwoFactor: z.boolean(),
})

export async function updateAccountAuthenticationSettings(
  input: z.infer<typeof updateAccountAuthSchema>,
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireAdmin()
    const instanceId = session.user.instanceId
    if (!instanceId) return { error: 'Instance not found' }

    const parsed = updateAccountAuthSchema.parse(input)
    const org = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { metadata: true },
    })
    if (!org) return { error: 'Instance not found' }

    const metadata = parseInstanceMetadata(org.metadata)
    const securitySettings: InstanceSecuritySettings = {
      ...metadata.securitySettings,
      requireTwoFactor: parsed.requireTwoFactor,
    }

    await db
      .update(instanceSettings)
      .set({
        metadata: {
          ...metadata,
          securitySettings,
        },
        updatedAt: new Date(),
      })
      .where(eq(instanceSettings.id, instanceId))

    return { success: true }
  } catch (err) {
    logError('updateAccountAuthenticationSettings failed:', err)
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
    await requireAgentCAManager()
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
    logError('uploadAgentCA failed:', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}
