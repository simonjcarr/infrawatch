import { defineUserConfig } from 'vuepress'
import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { searchPlugin } from '@vuepress/plugin-search'

export default defineUserConfig({
  base: '/infrawatch/',
  bundler: viteBundler(),
  lang: 'en-US',
  title: 'Infrawatch',
  description: 'Open-source infrastructure monitoring for engineering teams',

  theme: defaultTheme({
    logo: '/images/logo.svg',
    repo: 'simonjcarr/infrawatch',
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
        link: 'https://github.com/simonjcarr/infrawatch',
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
          '/features/alerts.md',
          '/features/notifications.md',
          '/features/reports.md',
          '/features/terminal.md',
          '/features/service-accounts.md',
          '/features/tasks.md',
        ],
      },
      {
        text: 'Deployment',
        collapsible: true,
        children: [
          '/deployment/docker-compose.md',
          '/deployment/air-gap.md',
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
