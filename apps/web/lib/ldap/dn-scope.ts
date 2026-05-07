export type LdapSearchScopeConfig = {
  baseDn: string
  userSearchBase?: string | null
}

function splitUnescaped(value: string, separators: Set<string>): string[] | null {
  const parts: string[] = []
  let current = ''
  let escaped = false

  for (const char of value) {
    if (escaped) {
      current += `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (separators.has(char)) {
      if (!current.trim()) return null
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (escaped || !current.trim()) return null
  parts.push(current.trim())
  return parts
}

function findUnescapedEquals(value: string): number {
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '=') return index
  }
  return -1
}

function normaliseDnValue(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{2}|.)/g, (_match, escaped: string) => {
      if (/^[0-9a-fA-F]{2}$/.test(escaped)) {
        return String.fromCharCode(Number.parseInt(escaped, 16))
      }
      return escaped
    })
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function normaliseRdn(rdn: string): string | null {
  const attrs = splitUnescaped(rdn, new Set(['+']))
  if (!attrs) return null

  const normalisedAttrs: string[] = []
  for (const attr of attrs) {
    const equalsIndex = findUnescapedEquals(attr)
    if (equalsIndex <= 0) return null

    const name = attr.slice(0, equalsIndex).trim().toLowerCase()
    const value = attr.slice(equalsIndex + 1)
    if (!name || !value.trim()) return null
    normalisedAttrs.push(`${name}=${normaliseDnValue(value)}`)
  }

  return normalisedAttrs.sort().join('+')
}

function parseDn(dn: string): string[] | null {
  const rdns = splitUnescaped(dn, new Set([',', ';']))
  if (!rdns) return null

  const normalised = rdns.map(normaliseRdn)
  if (normalised.some((rdn) => rdn == null)) return null
  return normalised as string[]
}

function isDnAtOrBelowBase(dn: string, baseDn: string, allowBase: boolean): boolean {
  const dnRdns = parseDn(dn)
  const baseRdns = parseDn(baseDn)
  if (!dnRdns || !baseRdns) return false
  if (dnRdns.length < baseRdns.length) return false
  if (!allowBase && dnRdns.length === baseRdns.length) return false

  for (let offset = 1; offset <= baseRdns.length; offset += 1) {
    if (dnRdns[dnRdns.length - offset] !== baseRdns[baseRdns.length - offset]) {
      return false
    }
  }

  return true
}

/** Resolve a search base: if it is absolute under baseDn, use as-is; otherwise append baseDn. */
export function resolveSearchBase(subBase: string | null | undefined, baseDn: string): string {
  if (!subBase) return baseDn
  if (isDnAtOrBelowBase(subBase, baseDn, true)) return subBase
  return `${subBase},${baseDn}`
}

export function isDnWithinSearchBase(dn: string, config: LdapSearchScopeConfig): boolean {
  const searchBase = resolveSearchBase(config.userSearchBase, config.baseDn)
  return isDnAtOrBelowBase(dn, searchBase, false)
}
