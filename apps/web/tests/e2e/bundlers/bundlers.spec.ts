import { test, expect } from '../fixtures/test'

test('authenticated user can resolve Jenkins and GitLab air-gap bundles', async ({ authenticatedPage: page }) => {
  const jenkinsBodies: Array<Record<string, unknown>> = []
  const gitlabBodies: Array<Record<string, unknown>> = []

  await page.route('**/api/tools/jenkins-bundler', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    jenkinsBodies.push(body)

    if (body.action === 'latest-lts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          version: '2.504.3',
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        coreVersion: '2.504.3',
        coreMinimumJava: 17,
        coreJavaSource: 'updates.jenkins.io',
        javaCompatible: true,
        warUrl: 'https://get.jenkins.io/war-stable/2.504.3/jenkins.war',
        plugins: [
          {
            name: 'credentials',
            requested: 'credentials',
            status: 'compatible',
            version: '1389.vd7a_b_f5fa_50a_2',
            url: 'https://updates.jenkins.io/download/plugins/credentials/1389.vd7a_b_f5fa_50a_2/credentials.hpi',
            requiredCore: '2.479.1',
            minimumJavaVersion: '17',
            size: 123456,
            sha256: 'sha-credentials',
            origin: 'requested',
          },
          {
            name: 'git',
            requested: 'git',
            status: 'compatible',
            version: '5.7.0',
            url: 'https://updates.jenkins.io/download/plugins/git/5.7.0/git.hpi',
            requiredCore: '2.479.3',
            minimumJavaVersion: '17',
            size: 654321,
            sha256: 'sha-git',
            origin: 'requested',
          },
        ],
        transitivePlugins: [],
      }),
    })
  })

  await page.route('**/api/tools/gitlab-bundler', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    gitlabBodies.push(body)

    if (body.action === 'latest') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          version: '18.6.1',
          edition: 'ee',
          packageTarget: {
            key: 'ubuntu-jammy',
            label: 'Ubuntu 22.04 Jammy',
            arch: 'amd64',
            kind: 'deb',
          },
          sources: {
            packages: 'https://packages.gitlab.com/gitlab/gitlab-ee/packages/ubuntu/jammy',
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        currentVersion: '17.11.5',
        targetVersion: '18.6.1',
        edition: 'ee',
        packageTarget: {
          key: 'ubuntu-jammy',
          label: 'Ubuntu 22.04 Jammy',
          arch: 'amd64',
          kind: 'deb',
        },
        generatedAt: '2026-04-29T12:00:00.000Z',
        sources: {
          upgradePath: 'https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/update/upgrade_paths.md',
          packages: 'https://packages.gitlab.com/gitlab/gitlab-ee/packages/ubuntu/jammy',
        },
        steps: [
          {
            id: 'gitlab-step-stop',
            role: 'required-stop',
            version: '18.2.3',
            majorMinor: '18.2',
            sourceVersion: '18.2.0',
            conditional: false,
            note: 'Required GitLab 18.2 upgrade stop.',
            packageName: 'gitlab-ee',
            filename: 'gitlab-ee_18.2.3-ee.0_amd64.deb',
            url: 'https://packages.gitlab.com/gitlab/gitlab-ee/packages/ubuntu/jammy/gitlab-ee_18.2.3-ee.0_amd64.deb/download.deb',
            sizeBytes: 1048576,
            sizeLabel: '1.0 MB',
            status: 'available',
          },
          {
            id: 'gitlab-step-target',
            role: 'target',
            version: '18.6.1',
            majorMinor: '18.6',
            sourceVersion: '18.6.1',
            conditional: false,
            note: null,
            packageName: 'gitlab-ee',
            filename: 'gitlab-ee_18.6.1-ee.0_amd64.deb',
            url: 'https://packages.gitlab.com/gitlab/gitlab-ee/packages/ubuntu/jammy/gitlab-ee_18.6.1-ee.0_amd64.deb/download.deb',
            sizeBytes: 2097152,
            sizeLabel: '2.0 MB',
            status: 'available',
          },
        ],
      }),
    })
  })

  await page.goto('/bundlers')

  await expect(page.getByRole('heading', { name: 'Air-gap Bundlers' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Jenkins' })).toHaveAttribute('aria-selected', 'true')

  await page.getByLabel('Jenkins WAR version').fill('2.504.3')
  await page.getByLabel('Your Java version (optional)').fill('17')
  await page.getByLabel('Plugin list').fill('git\ncredentials')
  await page.getByRole('button', { name: 'Resolve compatibility' }).click()

  await expect
    .poll(() => jenkinsBodies.at(-1))
    .toMatchObject({
      action: 'resolve',
      coreVersion: '2.504.3',
      javaVersion: 17,
      plugins: ['git', 'credentials'],
      includeTransitiveDeps: false,
    })

  await expect(page.getByText('Compatibility report')).toBeVisible()
  await expect(page.getByText('2 compatible')).toBeVisible()
  await expect(page.getByText('https://get.jenkins.io/war-stable/2.504.3/jenkins.war')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'credentials' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'git' })).toBeVisible()

  await page.getByRole('tab', { name: 'GitLab' }).click()
  await page.getByRole('button', { name: /use latest/i }).click()
  await expect(page.getByLabel('Target GitLab version')).toHaveValue('18.6.1')

  await page.getByLabel('Current GitLab version').fill('17.11.5')
  await page.getByRole('button', { name: 'Find upgrade packages' }).click()

  await expect
    .poll(() => gitlabBodies.at(-1))
    .toMatchObject({
      action: 'resolve',
      currentVersion: '17.11.5',
      targetVersion: '18.6.1',
      edition: 'ee',
      packageTarget: 'ubuntu-jammy',
      arch: 'amd64',
    })

  await expect(page.getByText('Resolved upgrade sequence')).toBeVisible()
  await expect(page.getByText('2 packages')).toBeVisible()
  await expect(page.getByRole('row', { name: /18\.2\.3/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /18\.6\.1/ })).toBeVisible()
  await expect(page.getByText('Required GitLab 18.2 upgrade stop.')).toBeVisible()
})
