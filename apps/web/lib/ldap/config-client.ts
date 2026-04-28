import type { LdapConfiguration } from '../db/schema'
import { sanitise } from '../response-sanitisation.ts'

export type LdapConfigurationSafe = Omit<LdapConfiguration, 'bindPassword'>

export function sanitiseLdapConfigurationForClient(
  config: LdapConfiguration,
): LdapConfigurationSafe {
  return sanitise(config, {
    bindPassword: 'omit',
  }) as LdapConfigurationSafe
}
