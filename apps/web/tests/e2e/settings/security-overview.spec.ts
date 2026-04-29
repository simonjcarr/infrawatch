import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'

const E2E_AGENT_CA_FORM_VALUE = 'placeholder'

function createAgentCaFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'ct-ops-security-ca-'))
  const keyPath = join(fixtureDir, 'agent-ca.key')
  const certPath = join(fixtureDir, 'agent-ca.crt')

  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=E2E Agent CA/O=Carrtech Test/C=GB',
      '-days',
      '3650',
    ], { stdio: 'ignore' })

    const certPem = readFileSync(certPath, 'utf8')
    const cert = new X509Certificate(certPem)

    return {
      certPem,
      subject: cert.subject,
      fingerprintSha256: cert.fingerprint256.replace(/:/g, '').toLowerCase(),
      notBefore: new Date(cert.validFrom).toISOString(),
      notAfter: new Date(cert.validTo).toISOString(),
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}

const E2E_AGENT_CA = createAgentCaFixture()

test('admin can review the current agent CA and upload form readiness in security settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    INSERT INTO certificate_authorities (
      id,
      organisation_id,
      purpose,
      cert_pem,
      key_pem_encrypted,
      source,
      fingerprint_sha256,
      not_before,
      not_after,
      metadata
    )
    VALUES (
      'e2e-agent-ca-current',
      NULL,
      'agent_ca',
      ${E2E_AGENT_CA.certPem},
      'encrypted-placeholder',
      'auto',
      ${E2E_AGENT_CA.fingerprintSha256},
      ${E2E_AGENT_CA.notBefore}::timestamptz,
      ${E2E_AGENT_CA.notAfter}::timestamptz,
      '{}'::jsonb
    )
  `

  await page.goto('/settings/security')

  await expect(page.getByTestId('security-settings-heading')).toBeVisible()
  await expect(page.getByTestId('security-agent-ca-card')).toBeVisible()
  await expect(page.getByTestId('security-agent-ca-source')).toContainText('Auto-generated')
  await expect(page.getByTestId('security-agent-ca-subject')).toContainText(E2E_AGENT_CA.subject)
  await expect(page.getByTestId('security-agent-ca-fingerprint')).toContainText(
    E2E_AGENT_CA.fingerprintSha256,
  )

  const uploadButton = page.getByTestId('security-upload-submit')
  await expect(uploadButton).toBeDisabled()

  await page.getByTestId('security-upload-cert').fill(E2E_AGENT_CA.certPem)
  await expect(uploadButton).toBeDisabled()

  await page.getByTestId('security-upload-key').fill(E2E_AGENT_CA_FORM_VALUE)
  await expect(uploadButton).toBeEnabled()

  await expect(page.getByRole('link', { name: 'Terminal access' })).toHaveAttribute(
    'href',
    '/settings/security/terminal',
  )
})
