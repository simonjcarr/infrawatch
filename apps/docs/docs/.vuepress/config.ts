import { defineUserConfig } from 'vuepress'
import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { searchPlugin } from '@vuepress/plugin-search'

export default defineUserConfig({
  base: '/ct-ops/',
  bundler: viteBundler(),
  lang: 'en-US',
  title: 'CT-Ops',
  description: 'Open-source infrastructure monitoring for engineering teams',

  theme: defaultTheme({
    logo: '/images/logo.svg',
    repo: 'carrtech-dev/ct-ops',
    docsDir: 'apps/docs/docs',
    editLink: true,
    editLinkText: 'Edit this page on GitHub',
    lastUpdated: true,
    lastUpdatedText: 'Last Updated',
    colorMode: 'dark',
    colorModeSwitch: true,

    navbar: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started/installation' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Features', link: '/features/hosts' },
      { text: 'Deployment', link: '/deployment/docker-compose' },
      {
        text: 'GitHub',
        link: 'https://github.com/carrtech-dev/ct-ops',
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        link: '/',
      },
      {
        text: 'Getting Started',
        collapsible: false,
        children: [
          '/getting-started/installation.md',
          '/getting-started/configuration.md',
          '/getting-started/agent-install-bundle.md',
        ],
      },
      {
        text: 'Architecture',
        collapsible: true,
        children: [
          '/architecture/overview.md',
          '/architecture/agent.md',
          '/architecture/ingest.md',
          '/architecture/deployment-profiles.md',
        ],
      },
      {
        text: 'Features',
        collapsible: true,
        children: [
          '/features/hosts.md',
          '/features/host-groups.md',
          '/features/networks.md',
          '/features/monitoring.md',
          '/features/certificates.md',
          '/features/certificate-checker.md',
          '/features/alerts.md',
          '/features/notifications.md',
          '/features/reports.md',
          '/features/terminal.md',
          '/features/service-accounts.md',
          '/features/directory-lookup.md',
          '/features/tasks.md',
          '/features/scheduled-tasks.md',
          '/features/tags.md',
          '/features/notes.md',
        ],
      },
      {
        text: 'Deployment',
        collapsible: true,
        children: [
          '/deployment/docker-compose.md',
          '/deployment/air-gap.md',
          '/deployment/load-testing.md',
        ],
      },
      {
        text: 'Development',
        collapsible: true,
        children: [
          '/development/testing.md',
        ],
      },
      {
        text: 'Licensing',
        link: '/licensing.md',
      },
      {
        text: 'Security',
        collapsible: true,
        children: [
          '/security.md',
          '/security/mtls.md',
        ],
      },
    ],
  }),

  plugins: [
    searchPlugin({
      locales: {
        '/': {
          placeholder: 'Search documentation...',
        },
      },
      getExtraFields: (page) => {
        const content = page.contentRendered
          .replace(/<[^>]+>/g, ' ')  // strip HTML tags
          .replace(/\s+/g, ' ')       // collapse whitespace
          .trim()
        return content ? [content] : []
      },
    }),
  ],
})
