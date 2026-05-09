export type LdapLoginOption = {
  id: string
  label: string
}

export type LdapLoginOptionRow = {
  ldapConfigurationId: string
  ldapConfigurationName: string
  ldapConfigurationHost: string
}

export function buildLdapLoginOptions(rows: readonly LdapLoginOptionRow[]): LdapLoginOption[] {
  const nameCounts = new Map<string, number>()

  for (const row of rows) {
    nameCounts.set(row.ldapConfigurationName, (nameCounts.get(row.ldapConfigurationName) ?? 0) + 1)
  }

  return rows.map((row) => {
    const hasDuplicateName = (nameCounts.get(row.ldapConfigurationName) ?? 0) > 1
    return {
      id: row.ldapConfigurationId,
      label: hasDuplicateName
        ? `${row.ldapConfigurationName} (${row.ldapConfigurationHost})`
        : row.ldapConfigurationName,
    }
  })
}
