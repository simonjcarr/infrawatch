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

test('overview aggregates agent, certificate, and alert counts for the instance', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)

  await sql`
    INSERT INTO agents (id, instance_id, hostname, public_key, status, os, arch)
    VALUES
      ('agent-online', ${instanceId}, 'agent-online', 'pk-online', 'active', 'Ubuntu 24.04', 'x86_64'),
      ('agent-offline', ${instanceId}, 'agent-offline', 'pk-offline', 'offline', 'Ubuntu 24.04', 'x86_64')
  `

  await sql`
    INSERT INTO hosts (id, instance_id, agent_id, hostname, display_name, os, arch, ip_addresses, status)
    VALUES
      ('host-alert', ${instanceId}, 'agent-online', 'host-alert', 'Alert Host', 'Ubuntu 24.04', 'x86_64', '["10.20.0.10"]'::jsonb, 'online')
  `

  await sql`
    INSERT INTO alert_rules (id, instance_id, host_id, name, condition_type, config, severity)
    VALUES
      (
        'alert-rule-cpu',
        ${instanceId},
        'host-alert',
        'High CPU',
        'metric_threshold',
        '{"metric":"cpu","operator":"gt","threshold":90}'::jsonb,
        'critical'
      )
  `

  await sql`
    INSERT INTO alert_instances (id, rule_id, host_id, instance_id, status, message, triggered_at)
    VALUES
      ('alert-firing', 'alert-rule-cpu', 'host-alert', ${instanceId}, 'firing', 'CPU over threshold', NOW()),
      ('alert-ack', 'alert-rule-cpu', 'host-alert', ${instanceId}, 'acknowledged', 'Investigating CPU', NOW())
  `

  await sql`
    INSERT INTO certificates (
      id,
      instance_id,
      source,
      host,
      port,
      server_name,
      common_name,
      issuer,
      sans,
      not_before,
      not_after,
      fingerprint_sha256,
      status,
      details
    )
    VALUES
      (
        'cert-valid',
        ${instanceId},
        'discovered',
        'valid.example.com',
        443,
        'valid.example.com',
        'valid.example.com',
        'CT Test CA',
        '["valid.example.com"]'::jsonb,
        NOW() - INTERVAL '10 days',
        NOW() + INTERVAL '20 days',
        'fingerprint-valid',
        'valid',
        '{"subject":"CN=valid.example.com","issuer":"CN=CT Test CA","serialNumber":"1001","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb
      ),
      (
        'cert-expiring',
        ${instanceId},
        'discovered',
        'expiring.example.com',
        443,
        'expiring.example.com',
        'expiring.example.com',
        'CT Test CA',
        '["expiring.example.com"]'::jsonb,
        NOW() - INTERVAL '20 days',
        NOW() + INTERVAL '2 days',
        'fingerprint-expiring',
        'expiring_soon',
        '{"subject":"CN=expiring.example.com","issuer":"CN=CT Test CA","serialNumber":"1002","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb
      ),
      (
        'cert-expired',
        ${instanceId},
        'discovered',
        'expired.example.com',
        443,
        'expired.example.com',
        'expired.example.com',
        'CT Test CA',
        '["expired.example.com"]'::jsonb,
        NOW() - INTERVAL '40 days',
        NOW() - INTERVAL '1 day',
        'fingerprint-expired',
        'expired',
        '{"subject":"CN=expired.example.com","issuer":"CN=CT Test CA","serialNumber":"1003","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb
      )
  `

  await page.goto('/dashboard')

  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
  await expect(page).toHaveTitle(`Overview | ${TEST_ORG.name}`)
  await expect(page.getByTestId('dashboard-instance-name')).toHaveText(TEST_ORG.name)
  await expect(page.getByTestId('dashboard-agents-total')).toContainText('2')
  await expect(page.getByTestId('dashboard-agents-online')).toContainText('1')
  await expect(page.getByTestId('dashboard-agents-offline')).toContainText('1')
  await expect(page.getByTestId('dashboard-certificates-valid')).toContainText('1')
  await expect(page.getByTestId('dashboard-certificates-expiring-soon')).toContainText('1')
  await expect(page.getByTestId('dashboard-certificates-expired')).toContainText('1')
  await expect(page.getByTestId('dashboard-alerts-firing')).toContainText('1')
  await expect(page.getByTestId('dashboard-alerts-acknowledged')).toContainText('1')

  const summary = page.getByTestId('dashboard-summary-issues')
  await expect(summary).toContainText('1 alert firing')
  await expect(summary).toContainText('1 certificate expired')
  await expect(summary).toContainText('1 agent offline')
})
