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
  'audit_events',
  'build_doc_asset_storage_settings',
  'build_doc_assets',
  'build_doc_revisions',
  'build_doc_sections',
  'build_doc_snippets',
  'build_doc_template_versions',
  'build_doc_templates',
  'build_docs',
  'calendar_event_participants',
  'calendar_event_hosts',
  'calendar_events',
  'certificate_authorities',
  'certificate_events',
  'certificates',
  'check_results',
  'checks',
  'ct_cve_service_nonces',
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
  'pending_cert_signings',
  'resource_tags',
  'revoked_certificates',
  'security_throttles',
  'saved_software_reports',
  'service_accounts',
  'software_packages',
  'software_scans',
  'ssh_keys',
  'system_config',
  'tag_rules',
  'tags',
  'task_run_hosts',
  'task_runs',
  'task_schedules',
  'terminal_sessions',
  'vulnerability_cves',
]

const AUTH_AND_ORG_TABLES = [
  'totp_credential',
  'session',
  'account',
  'verification',
  'user',
  'organisations',
]

export async function truncateAppTables(): Promise<void> {
  const sql = getTestDb()
  const list = [...APP_TABLES, ...AUTH_AND_ORG_TABLES].map((t) => `"${t}"`).join(', ')
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}
