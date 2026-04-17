import { Client } from 'ldapts'
import { decrypt } from '@/lib/crypto/encrypt'
import type { LdapConfiguration } from '@/lib/db/schema'

export interface LdapUser {
  dn: string
  username: string
  email: string | null
  displayName: string | null
  groups: string[]
  samAccountName?: string
  userPrincipalName?: string
  accountLocked?: boolean
  passwordExpiresAt?: Date | null
  passwordLastChangedAt?: Date | null
}

function getTlsOptions(config: LdapConfiguration): Record<string, unknown> | undefined {
  if (!config.useTls && !config.useStartTls) return undefined
  return config.tlsCertificate
    ? { ca: [config.tlsCertificate], rejectUnauthorized: true }
    : { rejectUnauthorized: false }
}

function createClient(config: LdapConfiguration): Client {
  const url = config.useTls
    ? `ldaps://${config.host}:${config.port}`
    : `ldap://${config.host}:${config.port}`

  return new Client({
    url,
    tlsOptions: config.useTls ? getTlsOptions(config) : undefined,
    connectTimeout: 10_000,
    timeout: 30_000,
  })
}

async function connectAndBind(config: LdapConfiguration, dn: string, password: string): Promise<Client> {
  const client = createClient(config)
  if (config.useStartTls && !config.useTls) {
    await client.startTLS(getTlsOptions(config) ?? {})
  }
  await client.bind(dn, password)
  return client
}

/** Resolve a search base: if it already ends with baseDn, use as-is; otherwise append baseDn. */
function resolveSearchBase(subBase: string | null | undefined, baseDn: string): string {
  if (!subBase) return baseDn
  // If the sub-base already contains the base DN (case-insensitive), use it directly
  if (subBase.toLowerCase().endsWith(baseDn.toLowerCase())) return subBase
  return `${subBase},${baseDn}`
}

function getBindPassword(config: LdapConfiguration): string {
  try {
    return decrypt(config.bindPassword)
  } catch {
    // Fallback: password might not be encrypted (e.g. during test before save)
    return config.bindPassword
  }
}

export async function testConnection(
  config: LdapConfiguration,
): Promise<{ success: true } | { error: string }> {
  try {
    const client = await connectAndBind(config, config.bindDn, getBindPassword(config))
    await client.unbind()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `LDAP connection failed: ${message}` }
  }
}

export async function searchUsers(
  config: LdapConfiguration,
  filter?: string,
): Promise<LdapUser[]> {
  let client: Client | undefined
  try {
    client = await connectAndBind(config, config.bindDn, getBindPassword(config))

    const searchBase = resolveSearchBase(config.userSearchBase, config.baseDn)

    const searchFilter = filter ?? config.userSearchFilter.replace('{{username}}', '*')

    const { searchEntries } = await client.search(searchBase, {
      filter: searchFilter,
      scope: 'sub',
      attributes: [
        config.usernameAttribute,
        config.emailAttribute,
        config.displayNameAttribute,
        'memberOf',
        'sAMAccountName',
        'userPrincipalName',
        // Password and lock attributes (AD)
        'userAccountControl',
        'lockoutTime',
        'pwdLastSet',
        'accountExpires',
        'msDS-UserPasswordExpiryTimeComputed',
        // OpenLDAP password policy attributes
        'pwdAccountLockedTime',
        'pwdChangedTime',
        'shadowExpire',
        'shadowLastChange',
        'shadowMax',
      ],
      sizeLimit: 1000,
    })

    await client!.unbind()

    return searchEntries.map((entry) => ({
      dn: entry.dn,
      username: String(entry[config.usernameAttribute] ?? ''),
      email: entry[config.emailAttribute] ? String(entry[config.emailAttribute]) || null : null,
      displayName: entry[config.displayNameAttribute] ? String(entry[config.displayNameAttribute]) || null : null,
      groups: Array.isArray(entry.memberOf)
        ? entry.memberOf.map(String)
        : entry.memberOf
          ? [String(entry.memberOf)]
          : [],
      samAccountName: entry.sAMAccountName ? String(entry.sAMAccountName) : undefined,
      userPrincipalName: entry.userPrincipalName ? String(entry.userPrincipalName) : undefined,
      ...parseAccountLockStatus(entry),
      ...parsePasswordExpiry(entry),
      ...parsePasswordLastChanged(entry),
    }))
  } catch (err) {
    await client?.unbind().catch(() => {})
    throw err
  }
}

// AD uses Windows file time (100-nanosecond intervals since 1601-01-01).
// This constant is the difference between the Windows epoch and Unix epoch in milliseconds.
const AD_EPOCH_DIFF_MS = BigInt('11644473600000')
const NEVER_EXPIRES = BigInt('9223372036854775807')

function adFileTimeToDate(value: string | number): Date | null {
  const bigVal = BigInt(value)
  if (bigVal <= BigInt(0) || bigVal === NEVER_EXPIRES) return null // never expires
  const unixMs = Number(bigVal / BigInt(10000) - AD_EPOCH_DIFF_MS)
  return new Date(unixMs)
}

function parseAccountLockStatus(entry: Record<string, unknown>): { accountLocked: boolean } {
  // AD: userAccountControl bit 0x0002 = ACCOUNTDISABLE, lockoutTime > 0 = locked
  if (entry.userAccountControl) {
    const uac = Number(entry.userAccountControl)
    if (uac & 0x0002) return { accountLocked: true }
  }
  if (entry.lockoutTime) {
    const lockoutTime = BigInt(String(entry.lockoutTime))
    if (lockoutTime > BigInt(0)) return { accountLocked: true }
  }
  // OpenLDAP: pwdAccountLockedTime is set when account is locked
  if (entry.pwdAccountLockedTime) return { accountLocked: true }
  return { accountLocked: false }
}

function parsePasswordExpiry(entry: Record<string, unknown>): { passwordExpiresAt: Date | null } {
  // AD: msDS-UserPasswordExpiryTimeComputed is the most accurate
  const computedExpiry = entry['msDS-UserPasswordExpiryTimeComputed']
  if (computedExpiry) {
    const d = adFileTimeToDate(String(computedExpiry))
    if (d) return { passwordExpiresAt: d }
  }
  // AD fallback: accountExpires
  if (entry.accountExpires) {
    const d = adFileTimeToDate(String(entry.accountExpires))
    if (d) return { passwordExpiresAt: d }
  }
  // OpenLDAP shadow: shadowLastChange + shadowMax (in days since epoch)
  if (entry.shadowLastChange && entry.shadowMax) {
    const lastChange = Number(entry.shadowLastChange)
    const max = Number(entry.shadowMax)
    if (lastChange > 0 && max > 0 && max < 99999) {
      return { passwordExpiresAt: new Date((lastChange + max) * 86400 * 1000) }
    }
  }
  return { passwordExpiresAt: null }
}

function parsePasswordLastChanged(entry: Record<string, unknown>): { passwordLastChangedAt: Date | null } {
  // AD: pwdLastSet (Windows file time)
  if (entry.pwdLastSet) {
    const d = adFileTimeToDate(String(entry.pwdLastSet))
    if (d) return { passwordLastChangedAt: d }
  }
  // OpenLDAP: pwdChangedTime (generalised time format: YYYYMMDDHHmmssZ)
  if (entry.pwdChangedTime) {
    const d = new Date(String(entry.pwdChangedTime))
    if (!isNaN(d.getTime())) return { passwordLastChangedAt: d }
  }
  // Shadow: shadowLastChange (days since epoch)
  if (entry.shadowLastChange) {
    const days = Number(entry.shadowLastChange)
    if (days > 0) return { passwordLastChangedAt: new Date(days * 86400 * 1000) }
  }
  return { passwordLastChangedAt: null }
}

// Attributes we already surface in typed fields — excluded from the rawAttributes
// map so the "all attributes" table isn't duplicated
const SUMMARY_ATTRIBUTES = new Set([
  'memberof',
  'userpassword',
  'unicodepwd',
  'dbcspwd',
  'lmpwdhistory',
  'ntpwdhistory',
  'supplementalcredentials',
])

function normaliseAttributeValue(value: unknown): string | string[] | null {
  if (value == null) return null
  if (Buffer.isBuffer(value)) {
    // Binary values — represent as base64 so the UI can still display them
    return `[binary ${value.length}B]`
  }
  if (Array.isArray(value)) {
    const mapped = value
      .map((v) => {
        if (v == null) return null
        if (Buffer.isBuffer(v)) return `[binary ${v.length}B]`
        return String(v)
      })
      .filter((v): v is string => v !== null)
    return mapped.length === 0 ? null : mapped
  }
  return String(value)
}

export interface LdapUserDetail extends LdapUser {
  rawAttributes: Record<string, string | string[]>
}

export async function lookupUserByDn(
  config: LdapConfiguration,
  dn: string,
): Promise<LdapUserDetail | null> {
  let client: Client | undefined
  try {
    client = await connectAndBind(config, config.bindDn, getBindPassword(config))

    const { searchEntries } = await client.search(dn, {
      filter: '(objectClass=*)',
      scope: 'base',
      // '*' returns all user attributes, '+' returns operational attributes
      attributes: ['*', '+'],
      sizeLimit: 1,
    })

    await client.unbind()

    const entry = searchEntries[0]
    if (!entry) return null

    const raw: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'dn') continue
      if (SUMMARY_ATTRIBUTES.has(key.toLowerCase())) continue
      const normalised = normaliseAttributeValue(value)
      if (normalised !== null) raw[key] = normalised
    }

    return {
      dn: entry.dn,
      username: String(entry[config.usernameAttribute] ?? ''),
      email: entry[config.emailAttribute] ? String(entry[config.emailAttribute]) || null : null,
      displayName: entry[config.displayNameAttribute] ? String(entry[config.displayNameAttribute]) || null : null,
      groups: Array.isArray(entry.memberOf)
        ? entry.memberOf.map(String)
        : entry.memberOf
          ? [String(entry.memberOf)]
          : [],
      samAccountName: entry.sAMAccountName ? String(entry.sAMAccountName) : undefined,
      userPrincipalName: entry.userPrincipalName ? String(entry.userPrincipalName) : undefined,
      ...parseAccountLockStatus(entry),
      ...parsePasswordExpiry(entry),
      ...parsePasswordLastChanged(entry),
      rawAttributes: raw,
    }
  } catch (err) {
    await client?.unbind().catch(() => {})
    throw err
  }
}

export async function authenticateUser(
  config: LdapConfiguration,
  username: string,
  password: string,
): Promise<{ success: true; user: LdapUser } | { error: string }> {
  let client: Client | undefined
  try {
    // First bind as service account to search for the user
    client = await connectAndBind(config, config.bindDn, getBindPassword(config))

    const searchBase = resolveSearchBase(config.userSearchBase, config.baseDn)

    const searchFilter = config.userSearchFilter.replace('{{username}}', username)

    const { searchEntries } = await client.search(searchBase, {
      filter: searchFilter,
      scope: 'sub',
      attributes: [
        config.usernameAttribute,
        config.emailAttribute,
        config.displayNameAttribute,
        'memberOf',
        'sAMAccountName',
        'userPrincipalName',
      ],
      sizeLimit: 1,
    })

    if (searchEntries.length === 0) {
      await client!.unbind()
      return { error: 'User not found in directory' }
    }

    const entry = searchEntries[0]!
    const userDn = entry.dn

    await client!.unbind()

    // Now bind as the user to verify password
    try {
      const userClient = await connectAndBind(config, userDn, password)
      await userClient.unbind()
    } catch {
      return { error: 'Invalid credentials' }
    }

    return {
      success: true,
      user: {
        dn: userDn,
        username: String(entry[config.usernameAttribute] ?? username),
        email: entry[config.emailAttribute] ? String(entry[config.emailAttribute]) || null : null,
        displayName: entry[config.displayNameAttribute] ? String(entry[config.displayNameAttribute]) || null : null,
        groups: Array.isArray(entry.memberOf)
          ? entry.memberOf.map(String)
          : entry.memberOf
            ? [String(entry.memberOf)]
            : [],
        samAccountName: entry.sAMAccountName ? String(entry.sAMAccountName) : undefined,
        userPrincipalName: entry.userPrincipalName ? String(entry.userPrincipalName) : undefined,
      },
    }
  } catch (err) {
    await client?.unbind().catch(() => {})
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `LDAP authentication failed: ${message}` }
  }
}
