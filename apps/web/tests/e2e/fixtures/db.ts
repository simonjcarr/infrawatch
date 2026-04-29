import postgres, { type Sql } from 'postgres'

let client: Sql | null = null

export function getTestDb(): Sql {
  if (client) return client
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL is not set — global-setup must run before fixtures are used')
  }
  client = postgres(url, { prepare: false, max: 2 })
  return client
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.end()
    client = null
  }
}

const APP_TABLES = [
  'agent_enrolment_tokens',
  'agent_queries',
  'agent_status_history',
  'agents',
  'alert_instances',
  'alert_rules',
  'alert_silences',
  'certificate_authorities',
  'certificate_events',
  'certificates',
  'check_results',
  'checks',
  'domain_accounts',
  'host_group_members',
  'host_groups',
  'host_metrics',
  'host_network_memberships',
  'host_package_updates',
  'host_patch_statuses',
  'host_vulnerability_findings',
  'hosts',
  'identity_events',
  'ingest_server_snapshots',
  'invitations',
  'ldap_configurations',
  'networks',
  'note_reactions',
  'note_revisions',
  'note_targets',
  'notes',
  'notification_channels',
  'notifications',
  'resource_tags',
  'security_throttles',
  'saved_software_reports',
  'service_accounts',
  'software_packages',
  'software_scans',
  'ssh_keys',
  'tag_rules',
  'tags',
  'task_run_hosts',
  'task_runs',
  'task_schedules',
  'terminal_sessions',
  'vulnerability_affected_packages',
  'vulnerability_cves',
  'vulnerability_sources',
]

export async function truncateAppTables(): Promise<void> {
  const sql = getTestDb()
  const list = APP_TABLES.map((t) => `"${t}"`).join(', ')
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  await sql.unsafe('DELETE FROM "session"')
}
