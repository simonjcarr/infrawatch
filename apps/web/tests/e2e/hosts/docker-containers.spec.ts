import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function seedHost(sql: ReturnType<typeof getTestDb>, instanceId: string, hostId: string) {
  await sql`
    INSERT INTO hosts (
      id,
      instance_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES (
      ${hostId},
      ${instanceId},
      ${`${hostId}.example.test`},
      ${`Docker ${hostId}`},
      'Ubuntu 24.04',
      'x86_64',
      '["10.90.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `
}

async function seedDockerStatus(sql: ReturnType<typeof getTestDb>, instanceId: string, hostId: string, status: string) {
  await sql`
    INSERT INTO host_docker_status (
      id,
      instance_id,
      host_id,
      status,
      checked_at
    )
    VALUES (
      ${`${hostId}-docker-status`},
      ${instanceId},
      ${hostId},
      ${status},
      NOW() - INTERVAL '1 minute'
    )
  `
}

test('host Containers tab lists containers and filters by name and state', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)
  await seedHost(sql, instanceId, 'docker-containers-host')
  await seedDockerStatus(sql, instanceId, 'docker-containers-host', 'installed')

  await sql`
    INSERT INTO docker_containers (
      id,
      instance_id,
      host_id,
      docker_container_id,
      primary_name,
      names_json,
      image,
      image_id,
      labels_json,
      state,
      status,
      created_at_source,
      started_at_source,
      first_seen_at,
      last_seen_at,
      last_inventory_at,
      restart_count,
      is_present
    )
    VALUES
      (
        'docker-containers-web-row',
        ${instanceId},
        'docker-containers-host',
        'web-container-id',
        'web',
        '["web","frontend"]'::jsonb,
        'nginx:1.27',
        'sha256:web',
        '{"com.example.service":"web"}'::jsonb,
        'running',
        'Up 4 minutes',
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '4 minutes',
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '30 seconds',
        NOW() - INTERVAL '30 seconds',
        2,
        true
      ),
      (
        'docker-containers-worker-row',
        ${instanceId},
        'docker-containers-host',
        'worker-container-id',
        'worker',
        '["worker"]'::jsonb,
        'redis:7',
        'sha256:worker',
        '{}'::jsonb,
        'exited',
        'Exited (0) 2 hours ago',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours',
        0,
        false
      )
  `

  await page.goto('/hosts/docker-containers-host')
  await page.getByTestId('host-parent-tab-containers').click()

  await expect(page.getByTestId('host-containers-tab')).toContainText('2 containers')
  await expect(page.getByTestId('host-docker-container-row-web-container-id')).toContainText('web')
  await expect(page.getByTestId('host-docker-container-row-web-container-id')).toContainText('nginx:1.27')
  await expect(page.getByTestId('host-docker-container-sparkline-web-container-id')).toBeVisible()
  await expect(page.getByTestId('host-docker-container-row-worker-container-id')).toContainText('worker')
  await expect(page.getByTestId('host-docker-container-row-worker-container-id')).toContainText('Not present')

  await page.getByTestId('host-containers-search').fill('nginx')
  await expect(page.getByTestId('host-docker-container-row-web-container-id')).toBeVisible()
  await expect(page.getByTestId('host-docker-container-row-worker-container-id')).toHaveCount(0)

  await page.getByTestId('host-containers-search').fill('')
  await page.getByTestId('host-containers-state-filter').click()
  await page.getByRole('option', { name: 'Running' }).click()
  await expect(page.getByTestId('host-docker-container-row-web-container-id')).toBeVisible()
  await expect(page.getByTestId('host-docker-container-row-worker-container-id')).toHaveCount(0)
})

test('host Containers tab shows per-container metric charts with max spike values', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)
  await seedHost(sql, instanceId, 'docker-container-metrics-host')
  await seedDockerStatus(sql, instanceId, 'docker-container-metrics-host', 'installed')

  await sql`
    INSERT INTO docker_containers (
      id,
      instance_id,
      host_id,
      docker_container_id,
      primary_name,
      names_json,
      image,
      image_id,
      labels_json,
      state,
      status,
      first_seen_at,
      last_seen_at,
      last_inventory_at,
      restart_count,
      is_present
    )
    VALUES
      (
        'docker-metrics-row',
        ${instanceId},
        'docker-container-metrics-host',
        'metrics-container-id',
        'metrics-web',
        '["metrics-web"]'::jsonb,
        'nginx:metrics',
        'sha256:metrics',
        '{}'::jsonb,
        'running',
        'Up 8 minutes',
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '30 seconds',
        NOW() - INTERVAL '30 seconds',
        1,
        true
      ),
      (
        'docker-metrics-worker-row',
        ${instanceId},
        'docker-container-metrics-host',
        'metrics-worker-container-id',
        'metrics-worker',
        '["metrics-worker"]'::jsonb,
        'worker:metrics',
        'sha256:metrics-worker',
        '{}'::jsonb,
        'running',
        'Up 7 minutes',
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '30 seconds',
        NOW() - INTERVAL '30 seconds',
        0,
        true
      )
  `

  await sql`
    INSERT INTO docker_container_metrics (
      id,
      instance_id,
      host_id,
      docker_container_row_id,
      docker_container_id,
      recorded_at,
      cpu_percent,
      memory_usage_bytes,
      memory_limit_bytes,
      memory_percent,
      network_rx_bytes,
      network_tx_bytes,
      block_read_bytes,
      block_write_bytes,
      pids_current,
      restart_count
    )
    VALUES
      (
        'docker-metrics-sample-1',
        ${instanceId},
        'docker-container-metrics-host',
        'docker-metrics-row',
        'metrics-container-id',
        NOW() - INTERVAL '20 minutes',
        12.5,
        268435456,
        1073741824,
        25.0,
        1000,
        2000,
        4096,
        8192,
        4,
        1
      ),
      (
        'docker-metrics-sample-2',
        ${instanceId},
        'docker-container-metrics-host',
        'docker-metrics-row',
        'metrics-container-id',
        NOW() - INTERVAL '10 minutes',
        96.4,
        805306368,
        1073741824,
        75.0,
        9000,
        12000,
        16384,
        32768,
        18,
        1
      ),
      (
        'docker-metrics-worker-sample-1',
        ${instanceId},
        'docker-container-metrics-host',
        'docker-metrics-worker-row',
        'metrics-worker-container-id',
        NOW() - INTERVAL '10 minutes',
        33.0,
        134217728,
        1073741824,
        12.5,
        100,
        250,
        2048,
        4096,
        2,
        0
      )
  `

  await page.goto('/hosts/docker-container-metrics-host')
  await page.getByTestId('host-parent-tab-containers').click()

  const metrics = page.getByTestId('host-docker-container-metrics')
  await expect(metrics).toContainText('metrics-web')
  await expect(metrics).toContainText('CPU max')
  await expect(metrics).toContainText('96.4%')
  await expect(metrics).toContainText('Memory max')
  await expect(metrics).toContainText('75.0%')
  await expect(metrics).toContainText('PIDs max')
  await expect(metrics).toContainText('18')
  await expect(metrics.getByText('CPU avg/max')).toBeVisible()
  await expect(metrics.getByText('Network I/O')).toBeVisible()
  await expect(metrics.getByText('Block I/O')).toBeVisible()

  await page.getByTestId('host-docker-metrics-container-select').click()
  await page.getByRole('option', { name: 'metrics-worker' }).click()
  await expect(metrics).toContainText('metrics-worker')
  await expect(metrics).toContainText('33.0%')
})

test('host Containers tab shows lifecycle in a sub tab scoped to the selected container', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)
  await seedHost(sql, instanceId, 'docker-lifecycle-host')
  await seedDockerStatus(sql, instanceId, 'docker-lifecycle-host', 'installed')

  await sql`
    INSERT INTO docker_containers (
      id,
      instance_id,
      host_id,
      docker_container_id,
      primary_name,
      names_json,
      image,
      image_id,
      labels_json,
      state,
      status,
      first_seen_at,
      last_seen_at,
      last_inventory_at,
      restart_count,
      is_present
    )
    VALUES
      ('docker-lifecycle-api-row', ${instanceId}, 'docker-lifecycle-host', 'lifecycle-api-container-id', 'lifecycle-api', '["lifecycle-api"]'::jsonb, 'api:latest', 'sha256:api', '{}'::jsonb, 'running', 'Up 9 minutes', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '30 seconds', NOW() - INTERVAL '30 seconds', 0, true),
      ('docker-lifecycle-worker-row', ${instanceId}, 'docker-lifecycle-host', 'lifecycle-worker-container-id', 'lifecycle-worker', '["lifecycle-worker"]'::jsonb, 'worker:latest', 'sha256:worker', '{}'::jsonb, 'exited', 'Exited', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '30 seconds', NOW() - INTERVAL '30 seconds', 1, true)
  `

  await sql`
    INSERT INTO docker_container_lifecycle_events (
      id,
      instance_id,
      host_id,
      docker_container_row_id,
      docker_container_id,
      primary_name,
      image,
      state,
      status,
      event_type,
      occurred_at,
      restart_count
    )
    VALUES
      ('lifecycle-api-started', ${instanceId}, 'docker-lifecycle-host', 'docker-lifecycle-api-row', 'lifecycle-api-container-id', 'lifecycle-api', 'api:latest', 'running', 'Up', 'started', NOW() - INTERVAL '10 minutes', 0),
      ('lifecycle-worker-stopped', ${instanceId}, 'docker-lifecycle-host', 'docker-lifecycle-worker-row', 'lifecycle-worker-container-id', 'lifecycle-worker', 'worker:latest', 'exited', 'Exited', 'stopped', NOW() - INTERVAL '5 minutes', 1)
  `

  await page.goto('/hosts/docker-lifecycle-host')
  await page.getByTestId('host-parent-tab-containers').click()

  await expect(page.getByTestId('host-docker-container-lifecycle')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Lifecycle' }).click()

  await page.getByTestId('host-docker-lifecycle-container-select').click()
  await page.getByRole('option', { name: 'lifecycle-worker' }).click()
  const lifecycle = page.getByTestId('host-docker-container-lifecycle')
  await expect(lifecycle).toContainText('lifecycle-worker')
  await expect(lifecycle).toContainText('Stopped')
  await expect(lifecycle).not.toContainText('lifecycle-api')
})

test('host Containers tab ranks top containers by selected metric and statistic', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)
  await seedHost(sql, instanceId, 'docker-top-containers-host')
  await seedDockerStatus(sql, instanceId, 'docker-top-containers-host', 'installed')

  await sql`
    INSERT INTO docker_containers (
      id,
      instance_id,
      host_id,
      docker_container_id,
      primary_name,
      names_json,
      image,
      image_id,
      labels_json,
      state,
      status,
      first_seen_at,
      last_seen_at,
      last_inventory_at,
      restart_count,
      is_present
    )
    VALUES
      ('docker-top-api-row', ${instanceId}, 'docker-top-containers-host', 'top-api-container-id', 'api', '["api"]'::jsonb, 'api:latest', 'sha256:api', '{}'::jsonb, 'running', 'Up 9 minutes', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '30 seconds', NOW() - INTERVAL '30 seconds', 0, true),
      ('docker-top-worker-row', ${instanceId}, 'docker-top-containers-host', 'top-worker-container-id', 'worker', '["worker"]'::jsonb, 'worker:latest', 'sha256:worker', '{}'::jsonb, 'running', 'Up 9 minutes', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '30 seconds', NOW() - INTERVAL '30 seconds', 0, true)
  `

  await sql`
    INSERT INTO docker_container_metrics (
      id,
      instance_id,
      host_id,
      docker_container_row_id,
      docker_container_id,
      recorded_at,
      cpu_percent,
      memory_usage_bytes,
      memory_limit_bytes,
      memory_percent,
      network_rx_bytes,
      network_tx_bytes,
      block_read_bytes,
      block_write_bytes,
      pids_current,
      restart_count
    )
    VALUES
      ('docker-top-api-sample-1', ${instanceId}, 'docker-top-containers-host', 'docker-top-api-row', 'top-api-container-id', NOW() - INTERVAL '15 minutes', 55.0, 1000, 4000, 25.0, 1000, 1200, 100, 200, 4, 0),
      ('docker-top-api-sample-2', ${instanceId}, 'docker-top-containers-host', 'docker-top-api-row', 'top-api-container-id', NOW() - INTERVAL '10 minutes', 82.4, 2400, 4000, 60.0, 8000, 7000, 300, 500, 6, 0),
      ('docker-top-worker-sample-1', ${instanceId}, 'docker-top-containers-host', 'docker-top-worker-row', 'top-worker-container-id', NOW() - INTERVAL '15 minutes', 12.0, 3200, 4000, 80.0, 1200, 1400, 9000, 8000, 3, 0),
      ('docker-top-worker-sample-2', ${instanceId}, 'docker-top-containers-host', 'docker-top-worker-row', 'top-worker-container-id', NOW() - INTERVAL '10 minutes', 16.0, 3600, 4000, 90.0, 1800, 1800, 12000, 11000, 4, 0)
  `

  await page.goto('/hosts/docker-top-containers-host')
  await page.getByTestId('host-parent-tab-containers').click()

  const topContainers = page.getByTestId('host-docker-top-containers')
  await expect(topContainers).toContainText('Top containers')
  await expect(topContainers).toContainText('Ranks containers by their highest or P95 resource use over the selected range.')
  await expect(page.getByTestId('host-docker-top-container-row-top-api-container-id')).toContainText('82.4%')

  await page.getByTestId('host-docker-top-metric-select').click()
  await page.getByRole('option', { name: 'Memory' }).click()
  await expect(page.getByTestId('host-docker-top-container-row-top-worker-container-id')).toContainText('90.0%')

  await page.getByTestId('host-docker-top-stat-select').click()
  await page.getByRole('option', { name: 'P95' }).click()
  await expect(topContainers).toContainText('P95')
})

test('host Containers tab explains Docker unavailable states', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)
  await seedHost(sql, instanceId, 'docker-containers-denied')
  await seedDockerStatus(sql, instanceId, 'docker-containers-denied', 'permission_denied')

  await page.goto('/hosts/docker-containers-denied')
  await page.getByTestId('host-parent-tab-containers').click()

  const tab = page.getByTestId('host-containers-tab')
  await expect(tab).toContainText('Permission denied')
  await expect(tab).toContainText('The agent found Docker but cannot read container inventory.')
})
