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
}

function createClient(config: LdapConfiguration): Client {
  const url = config.useTls
    ? `ldaps://${config.host}:${config.port}`
    : `ldap://${config.host}:${config.port}`

  return new Client({
    url,
    tlsOptions: config.useTls ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10_000,
    timeout: 30_000,
  })
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
  const client = createClient(config)
  try {
    await client.bind(config.bindDn, getBindPassword(config))
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
  const client = createClient(config)
  try {
    await client.bind(config.bindDn, getBindPassword(config))

    const searchBase = config.userSearchBase
      ? `${config.userSearchBase},${config.baseDn}`
      : config.baseDn

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
      ],
      sizeLimit: 1000,
    })

    await client.unbind()

    return searchEntries.map((entry) => ({
      dn: entry.dn,
      username: String(entry[config.usernameAttribute] ?? ''),
      email: entry[config.emailAttribute] ? String(entry[config.emailAttribute]) : null,
      displayName: entry[config.displayNameAttribute] ? String(entry[config.displayNameAttribute]) : null,
      groups: Array.isArray(entry.memberOf)
        ? entry.memberOf.map(String)
        : entry.memberOf
          ? [String(entry.memberOf)]
          : [],
      samAccountName: entry.sAMAccountName ? String(entry.sAMAccountName) : undefined,
      userPrincipalName: entry.userPrincipalName ? String(entry.userPrincipalName) : undefined,
    }))
  } catch (err) {
    await client.unbind().catch(() => {})
    throw err
  }
}

export async function authenticateUser(
  config: LdapConfiguration,
  username: string,
  password: string,
): Promise<{ success: true; user: LdapUser } | { error: string }> {
  const client = createClient(config)
  try {
    // First bind as service account to search for the user
    await client.bind(config.bindDn, getBindPassword(config))

    const searchBase = config.userSearchBase
      ? `${config.userSearchBase},${config.baseDn}`
      : config.baseDn

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
      await client.unbind()
      return { error: 'User not found in directory' }
    }

    const entry = searchEntries[0]!
    const userDn = entry.dn

    await client.unbind()

    // Now bind as the user to verify password
    const userClient = createClient(config)
    try {
      await userClient.bind(userDn, password)
      await userClient.unbind()
    } catch {
      return { error: 'Invalid credentials' }
    }

    return {
      success: true,
      user: {
        dn: userDn,
        username: String(entry[config.usernameAttribute] ?? username),
        email: entry[config.emailAttribute] ? String(entry[config.emailAttribute]) : null,
        displayName: entry[config.displayNameAttribute] ? String(entry[config.displayNameAttribute]) : null,
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
    await client.unbind().catch(() => {})
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `LDAP authentication failed: ${message}` }
  }
}
