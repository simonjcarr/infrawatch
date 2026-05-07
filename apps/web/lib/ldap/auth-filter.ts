// RFC 4515 §3: escape special characters before interpolating user input into LDAP filters.
export function escapeLdapFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00')
}

function interpolateUsernameFilter(filter: string, username: string): string {
  return filter.replace('{{username}}', escapeLdapFilterValue(username))
}

export function buildAuthenticateUserSearchFilter(
  configuredFilter: string,
  username: string,
): string {
  const filters = [
    interpolateUsernameFilter(configuredFilter, username),
  ]

  const atIndex = username.indexOf('@')
  if (atIndex > 0 && atIndex < username.length - 1) {
    filters.push(`(userPrincipalName=${escapeLdapFilterValue(username)})`)
    filters.push(interpolateUsernameFilter(configuredFilter, username.slice(0, atIndex)))
  }

  const uniqueFilters = [...new Set(filters)]
  return uniqueFilters.length === 1 ? uniqueFilters[0]! : `(|${uniqueFilters.join('')})`
}
