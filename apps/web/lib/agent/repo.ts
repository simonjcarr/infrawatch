/**
 * Source repository for the official Infrawatch agent binaries.
 *
 * Hardcoded on purpose: there is exactly one place agent binaries come from.
 * Customers should never be configuring this — if the project is renamed
 * before public release, it's a one-time grep/replace per CLAUDE.md, not a
 * customer-facing toggle.
 */
export const AGENT_REPO_OWNER = 'simonjcarr'
export const AGENT_REPO_NAME = 'infrawatch'
