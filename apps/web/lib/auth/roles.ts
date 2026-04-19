export const ADMIN_ROLES = ['org_admin', 'super_admin'] as const

export const MEMBERSHIP_ROLES = ['org_admin', 'super_admin', 'engineer'] as const

export const DEFAULT_NOTIFICATION_ROLES = ['super_admin', 'org_admin', 'engineer'] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]
