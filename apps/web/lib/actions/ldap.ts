'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { ldapConfigurations, domainAccounts } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { LdapConfiguration } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto/encrypt'
import { testConnection as ldapTestConnection, searchUsers } from '@/lib/ldap/client'

const createLdapConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).default(389),
  useTls: z.boolean().default(false),
  useStartTls: z.boolean().default(false),
  tlsCertificate: z.string().optional(),
  baseDn: z.string().min(1, 'Base DN is required'),
  bindDn: z.string().min(1, 'Bind DN is required'),
  bindPassword: z.string().min(1, 'Bind password is required'),
  userSearchBase: z.string().optional(),
  userSearchFilter: z.string().default('(uid={{username}})'),
  groupSearchBase: z.string().optional(),
  groupSearchFilter: z.string().optional(),
  usernameAttribute: z.string().default('uid'),
  emailAttribute: z.string().default('mail'),
  displayNameAttribute: z.string().default('cn'),
  allowLogin: z.boolean().default(false),
  syncIntervalMinutes: z.number().int().min(5).max(1440).default(60),
})

const updateLdapConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  useTls: z.boolean().optional(),
  useStartTls: z.boolean().optional(),
  tlsCertificate: z.string().nullable().optional(),
  baseDn: z.string().min(1).optional(),
  bindDn: z.string().min(1).optional(),
  bindPassword: z.string().min(1).optional(),
  userSearchBase: z.string().optional(),
  userSearchFilter: z.string().optional(),
  groupSearchBase: z.string().optional(),
  groupSearchFilter: z.string().optional(),
  usernameAttribute: z.string().optional(),
  emailAttribute: z.string().optional(),
  displayNameAttribute: z.string().optional(),
  enabled: z.boolean().optional(),
  allowLogin: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
})

export async function getLdapConfigurations(
  orgId: string,
): Promise<LdapConfiguration[]> {
  return db.query.ldapConfigurations.findMany({
    where: and(
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
    orderBy: ldapConfigurations.createdAt,
  })
}

export async function getLdapConfiguration(
  orgId: string,
  configId: string,
): Promise<LdapConfiguration | null> {
  const result = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  return result ?? null
}

export async function createLdapConfiguration(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createLdapConfigSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const encryptedPassword = encrypt(parsed.data.bindPassword)

    const [row] = await db
      .insert(ldapConfigurations)
      .values({
        organisationId: orgId,
        name: parsed.data.name,
        host: parsed.data.host,
        port: parsed.data.port,
        useTls: parsed.data.useTls,
        useStartTls: parsed.data.useStartTls,
        tlsCertificate: parsed.data.tlsCertificate || null,
        baseDn: parsed.data.baseDn,
        bindDn: parsed.data.bindDn,
        bindPassword: encryptedPassword,
        userSearchBase: parsed.data.userSearchBase || null,
        userSearchFilter: parsed.data.userSearchFilter,
        groupSearchBase: parsed.data.groupSearchBase || null,
        groupSearchFilter: parsed.data.groupSearchFilter || null,
        usernameAttribute: parsed.data.usernameAttribute,
        emailAttribute: parsed.data.emailAttribute,
        displayNameAttribute: parsed.data.displayNameAttribute,
        allowLogin: parsed.data.allowLogin,
        syncIntervalMinutes: parsed.data.syncIntervalMinutes,
      })
      .returning({ id: ldapConfigurations.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch (err) {
    console.error('Failed to create LDAP configuration:', err)
    return { error: 'Failed to create LDAP configuration' }
  }
}

export async function updateLdapConfiguration(
  orgId: string,
  configId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateLdapConfigSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const existing = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!existing) return { error: 'Configuration not found' }

  const data = parsed.data
  const updates: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) updates.name = data.name
  if (data.host !== undefined) updates.host = data.host
  if (data.port !== undefined) updates.port = data.port
  if (data.useTls !== undefined) updates.useTls = data.useTls
  if (data.useStartTls !== undefined) updates.useStartTls = data.useStartTls
  if (data.tlsCertificate !== undefined) updates.tlsCertificate = data.tlsCertificate || null
  if (data.baseDn !== undefined) updates.baseDn = data.baseDn
  if (data.bindDn !== undefined) updates.bindDn = data.bindDn
  if (data.bindPassword !== undefined) updates.bindPassword = encrypt(data.bindPassword)
  if (data.userSearchBase !== undefined) updates.userSearchBase = data.userSearchBase || null
  if (data.userSearchFilter !== undefined) updates.userSearchFilter = data.userSearchFilter
  if (data.groupSearchBase !== undefined) updates.groupSearchBase = data.groupSearchBase || null
  if (data.groupSearchFilter !== undefined) updates.groupSearchFilter = data.groupSearchFilter || null
  if (data.usernameAttribute !== undefined) updates.usernameAttribute = data.usernameAttribute
  if (data.emailAttribute !== undefined) updates.emailAttribute = data.emailAttribute
  if (data.displayNameAttribute !== undefined) updates.displayNameAttribute = data.displayNameAttribute
  if (data.enabled !== undefined) updates.enabled = data.enabled
  if (data.allowLogin !== undefined) updates.allowLogin = data.allowLogin
  if (data.syncIntervalMinutes !== undefined) updates.syncIntervalMinutes = data.syncIntervalMinutes

  await db
    .update(ldapConfigurations)
    .set(updates)
    .where(and(eq(ldapConfigurations.id, configId), eq(ldapConfigurations.organisationId, orgId)))

  return { success: true }
}

export async function deleteLdapConfiguration(
  orgId: string,
  configId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!existing) return { error: 'Configuration not found' }

  await db
    .update(ldapConfigurations)
    .set({ deletedAt: new Date() })
    .where(and(eq(ldapConfigurations.id, configId), eq(ldapConfigurations.organisationId, orgId)))

  return { success: true }
}

export async function testLdapConnection(
  orgId: string,
  configId: string,
): Promise<{ success: true } | { error: string }> {
  const config = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!config) return { error: 'Configuration not found' }

  return ldapTestConnection(config)
}

export async function syncLdapAccounts(
  orgId: string,
  configId: string,
): Promise<{ success: true; count: number } | { error: string }> {
  const config = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!config) return { error: 'Configuration not found' }

  // Mark sync as running
  await db
    .update(ldapConfigurations)
    .set({ lastSyncStatus: 'running', lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(ldapConfigurations.id, configId))

  try {
    const users = await searchUsers(config)

    const source = config.name.toLowerCase().includes('active directory')
      ? 'active_directory' as const
      : 'ldap' as const

    let syncedCount = 0
    for (const user of users) {
      if (!user.username) continue

      // Upsert: try insert, on conflict update
      const status = user.accountLocked ? 'locked' as const : 'active' as const

      await db
        .insert(domainAccounts)
        .values({
          organisationId: orgId,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          source,
          distinguishedName: user.dn,
          samAccountName: user.samAccountName ?? null,
          userPrincipalName: user.userPrincipalName ?? null,
          groups: user.groups.length > 0 ? user.groups : null,
          status,
          accountLocked: user.accountLocked ?? false,
          passwordExpiresAt: user.passwordExpiresAt ?? null,
          passwordLastChangedAt: user.passwordLastChangedAt ?? null,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [domainAccounts.organisationId, domainAccounts.source, domainAccounts.username],
          set: {
            displayName: user.displayName,
            email: user.email,
            distinguishedName: user.dn,
            samAccountName: user.samAccountName ?? null,
            userPrincipalName: user.userPrincipalName ?? null,
            groups: user.groups.length > 0 ? user.groups : null,
            status,
            accountLocked: user.accountLocked ?? false,
            passwordExpiresAt: user.passwordExpiresAt ?? null,
            passwordLastChangedAt: user.passwordLastChangedAt ?? null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        })

      syncedCount++
    }

    // Mark sync as successful
    await db
      .update(ldapConfigurations)
      .set({ lastSyncStatus: 'success', lastSyncError: null, updatedAt: new Date() })
      .where(eq(ldapConfigurations.id, configId))

    return { success: true, count: syncedCount }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await db
      .update(ldapConfigurations)
      .set({ lastSyncStatus: 'error', lastSyncError: message, updatedAt: new Date() })
      .where(eq(ldapConfigurations.id, configId))

    return { error: `Sync failed: ${message}` }
  }
}

export async function hasLdapLoginEnabled(): Promise<boolean> {
  const config = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.enabled, true),
      eq(ldapConfigurations.allowLogin, true),
      isNull(ldapConfigurations.deletedAt),
    ),
    columns: { id: true },
  })
  return config != null
}
