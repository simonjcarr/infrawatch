import { createId } from '@paralleldrive/cuid2'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM instance_settings WHERE slug = ${TEST_INSTANCE.slug} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('admin can view ingest status, agent errors, and upgrade counts', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const agentId = createId()
  const hostId = createId()

  await sql`
    INSERT INTO agents (
      id, instance_id, hostname, public_key, status, version, last_heartbeat_at
    )
    VALUES (
      ${agentId}, ${instanceId}, 'ops-agent-01', 'public-key-system-health', 'active', 'v0.1.0', NOW()
    )
  `
  await sql`
    INSERT INTO hosts (
      id, instance_id, agent_id, hostname, os, status, last_seen_at
    )
    VALUES (
      ${hostId}, ${instanceId}, ${agentId}, 'ops-agent-01', 'linux', 'online', NOW()
    )
  `
  await sql`
    INSERT INTO ingest_server_snapshots (
      id, server_id, hostname, process_id, version, started_at, observed_at,
      active_requests, messages_received_total, queue_depth, queue_capacity,
      goroutines, heap_alloc_bytes, heap_sys_bytes, db_open_connections,
      db_acquired_connections, gc_pause_total_ns
    )
    VALUES
      (${createId()}, 'ingest-a', 'ingest-a', 101, 'v1', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '50 minutes', 1, 10, 0, 1000, 12, 1048576, 2097152, 3, 1, 0),
      (${createId()}, 'ingest-a', 'ingest-a', 101, 'v1', NOW() - INTERVAL '2 hours', NOW(), 2, 25, 1, 1000, 14, 2097152, 4194304, 4, 2, 0)
  `
  await sql`
    INSERT INTO agent_queries (
      id, instance_id, host_id, query_type, status, error, requested_at, completed_at, expires_at
    )
    VALUES (
      ${createId()}, ${instanceId}, ${hostId}, 'list_services', 'error', 'service inventory timed out', NOW() - INTERVAL '1 minute', NOW(), NOW() + INTERVAL '1 hour'
    )
  `
  const taskRunId = createId()
  const taskRunHostId = createId()
  await sql`
    INSERT INTO task_runs (
      id, instance_id, triggered_by, target_type, target_id,
      task_type, config, max_parallel, status, created_at, updated_at
    )
    VALUES (
      ${taskRunId}, ${instanceId}, NULL, 'host', ${hostId},
      'software_inventory', '{}', 1, 'failed', NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes'
    )
  `
  await sql`
    INSERT INTO task_run_hosts (
      id, instance_id, task_run_id, host_id, status, exit_code,
      raw_output, error_message, started_at, completed_at, created_at, updated_at
    )
    VALUES (
      ${taskRunHostId}, ${instanceId}, ${taskRunId}, ${hostId}, 'failed', -1,
      'collecting installed packages... collected 690 packages (source: dpkg), streaming to server... chunk 0 sent (500 packages) chunk 1 sent (190 packages)',
      'streaming packages: closing stream: rpc error: code = Unauthenticated desc = invalid token',
      NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes'
    )
  `

  await page.goto('/settings/system')

  await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible()
  await expect(page.getByText('Ingest Servers')).toBeVisible()
  await expect(page.getByText('1/1', { exact: true })).toBeVisible()
  await expect(page.getByText('Received last hour')).toBeVisible()
  await expect(page.getByRole('cell', { name: '25' })).toBeVisible()

  await expect(page.getByText('Agent Errors')).toBeVisible()
  await expect(page.getByText('ops-agent-01')).toBeVisible()
  await expect(page.getByText('service inventory timed out')).toBeVisible()
  await expect(page.getByText('streaming packages: closing stream')).toBeVisible()
  await page.getByRole('button', { name: 'View more' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Agent error detail' })).toBeVisible()
  await expect(page.getByText('collecting installed packages...')).not.toBeVisible()
  await expect(page.getByText('rpc error: code = Unauthenticated desc = invalid token')).toBeVisible()
  await expect(page.getByText('Not upgraded')).toBeVisible()
})
