'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { ldapConfigurations } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { LdapConfiguration } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto/encrypt'
import { testConnection as ldapTestConnection, searchUsers, lookupUserByDn } from '@/lib/ldap/client'
import type { LdapUser, LdapUserDetail } from '@/lib/ldap/client'

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

export type LdapUserResult = {
  username: string
  displayName: string | null
  email: string | null
  dn: string
  groups: string[]
  samAccountName?: string
  userPrincipalName?: string
  accountLocked: boolean
  passwordExpiresAt: string | null
  passwordLastChangedAt: string | null
}

function toLdapUserResult(user: LdapUser): LdapUserResult {
  return {
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    dn: user.dn,
    groups: user.groups,
    samAccountName: user.samAccountName,
    userPrincipalName: user.userPrincipalName,
    accountLocked: user.accountLocked ?? false,
    passwordExpiresAt: user.passwordExpiresAt?.toISOString() ?? null,
    passwordLastChangedAt: user.passwordLastChangedAt?.toISOString() ?? null,
  }
}

export async function searchLdapDirectory(
  orgId: string,
  configId: string,
  query: string,
): Promise<{ success: true; users: LdapUserResult[] } | { error: string }> {
  if (!query.trim()) return { success: true, users: [] }

  const config = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!config) return { error: 'Configuration not found' }

  try {
    const filter = config.userSearchFilter.replace('{{username}}', `${query.trim()}*`)
    const users = await searchUsers(config, filter)
    return { success: true, users: users.slice(0, 5).map(toLdapUserResult) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Directory search failed: ${message}` }
  }
}

export type LookupConfigOption = {
  id: string
  name: string
}

export async function getLookupConfigOptions(
  orgId: string,
): Promise<LookupConfigOption[]> {
  const rows = await db.query.ldapConfigurations.findMany({
    where: and(
      eq(ldapConfigurations.organisationId, orgId),
      eq(ldapConfigurations.enabled, true),
      isNull(ldapConfigurations.deletedAt),
    ),
    columns: { id: true, name: true },
    orderBy: ldapConfigurations.name,
  })
  return rows
}

export type LdapUserDetailResult = LdapUserResult & {
  rawAttributes: Record<string, string | string[]>
}

export async function lookupDirectoryUser(
  orgId: string,
  configId: string,
  dn: string,
): Promise<{ success: true; user: LdapUserDetailResult } | { error: string }> {
  const config = await db.query.ldapConfigurations.findFirst({
    where: and(
      eq(ldapConfigurations.id, configId),
      eq(ldapConfigurations.organisationId, orgId),
      isNull(ldapConfigurations.deletedAt),
    ),
  })
  if (!config) return { error: 'Configuration not found' }

  try {
    const detail: LdapUserDetail | null = await lookupUserByDn(config, dn)
    if (!detail) return { error: 'User not found' }
    return {
      success: true,
      user: {
        ...toLdapUserResult(detail),
        rawAttributes: detail.rawAttributes,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Directory lookup failed: ${message}` }
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
