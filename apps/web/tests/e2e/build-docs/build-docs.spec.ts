import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return { orgId: rows[0]!.org_id, userId: rows[0]!.user_id }
}

test('admin can create and export a build document from a template and snippet', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId } = await getOrgAndUserIds(sql)

  await page.goto('/build-docs')
  await expect(page.getByTestId('build-docs-heading')).toBeVisible()

  await page.getByRole('tab', { name: /templates/i }).click()
  await page.getByPlaceholder('Standard VM build').fill('E2E VM build template')
  await page.getByPlaceholder('Template purpose').fill('Standard customer VM build handover document.')
  await page.getByRole('button', { name: /create template/i }).click()

  await page.getByRole('tab', { name: /snippets/i }).click()
  await page.getByPlaceholder('Install nginx').fill('Install nginx')
  await page.getByPlaceholder('nginx, web, ubuntu').fill('nginx, ubuntu')
  await page.getByPlaceholder('Commands and notes').fill('sudo apt update\nsudo apt install -y nginx')
  await page.getByRole('button', { name: /create snippet/i }).click()
  await expect(page.getByText('Install nginx')).toBeVisible()

  await page.getByRole('tab', { name: /documents/i }).click()
  await page.getByLabel('Title').fill('E2E production VM build')
  await page.getByLabel('Host').fill('prod-web-01')
  await page.getByLabel('Customer').first().fill('Acme')
  await page.getByLabel('Customer *').fill('Acme')
  await page.getByLabel('Production VM *').check()
  await page.getByRole('button', { name: /create build doc/i }).click()

  await expect(page).toHaveURL(/\/build-docs\/.+/)
  await expect(page.getByTestId('build-doc-editor-heading')).toContainText('E2E production VM build')

  await page.getByPlaceholder('Install applications').fill('Provision VM')
  await page.getByPlaceholder('Commands, decisions, and verification notes').fill('Created the VM and attached the initial OS disk.')
  await page.getByRole('button', { name: /add section/i }).click()
  await expect(page.getByText('Provision VM')).toBeVisible()

  await page.getByRole('button', { name: /install nginx/i }).click()
  await expect(page.getByText('Snippet v1')).toBeVisible()

  const tmpDir = path.join(process.cwd(), 'tests', 'e2e', '.tmp')
  await mkdir(tmpDir, { recursive: true })
  const imagePath = path.join(tmpDir, 'build-doc-e2e.png')
  await writeFile(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ))
  const sectionCard = page.locator('[data-section-title="Provision VM"]')
  await sectionCard.locator('input[type="file"]').setInputFiles(imagePath)
  await sectionCard.getByRole('button').last().click()
  await expect(sectionCard.getByText('1 images')).toBeVisible()

  await page.getByRole('tab', { name: /preview/i }).click()
  await expect(page.getByTestId('build-doc-preview')).toContainText('Index')
  await expect(page.getByTestId('build-doc-preview')).toContainText('Provision VM')
  await expect(page.getByTestId('build-doc-preview')).toContainText('Install nginx')
  await expect(page.getByRole('link', { name: /pdf/i })).toHaveAttribute('href', /format=pdf/)
  await expect(page.getByRole('link', { name: /word/i })).toHaveAttribute('href', /format=docx/)

  await page.goto('/build-docs')
  await page.getByTestId('build-doc-search').fill('nginx')
  await page.getByTestId('build-doc-search-submit').click()
  await expect(page.getByRole('link', { name: 'E2E production VM build' })).toBeVisible()

  const docs = await sql<Array<{ doc_count: number; section_count: number; asset_count: number }>>`
    SELECT
      cast(count(DISTINCT d.id) AS int) AS doc_count,
      cast(count(DISTINCT s.id) AS int) AS section_count,
      cast(count(DISTINCT a.id) AS int) AS asset_count
    FROM build_docs d
    LEFT JOIN build_doc_sections s ON s.build_doc_id = d.id
    LEFT JOIN build_doc_assets a ON a.build_doc_id = d.id
    WHERE d.organisation_id = ${orgId}
      AND d.title = 'E2E production VM build'
  `
  expect(docs[0]).toEqual({ doc_count: 1, section_count: 2, asset_count: 1 })
})
