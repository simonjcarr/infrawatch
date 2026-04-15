import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'Infrawatch',
  tagline: 'Open-source infrastructure monitoring for engineering teams',
  favicon: 'img/logo.svg',

  url: 'https://simonjcarr.github.io',
  baseUrl: '/infrawatch/',

  organizationName: 'simonjcarr',
  projectName: 'infrawatch',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/simonjcarr/infrawatch/edit/main/apps/docs/',
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    image: 'img/social-card.png',
    navbar: {
      title: 'Infrawatch',
      logo: {
        alt: 'Infrawatch Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'mainSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/simonjcarr/infrawatch',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/getting-started/installation' },
            { label: 'Architecture', to: '/architecture/overview' },
            { label: 'Deployment', to: '/deployment/docker-compose' },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/simonjcarr/infrawatch',
            },
            {
              label: 'Issues',
              href: 'https://github.com/simonjcarr/infrawatch/issues',
            },
            {
              label: 'Releases',
              href: 'https://github.com/simonjcarr/infrawatch/releases',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Infrawatch contributors. Apache 2.0 Licensed.`,
    },
    prism: {
      theme: prismThemes.vsDark,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: [
        'bash',
        'yaml',
        'toml',
        'docker',
        'go',
        'protobuf',
        'nginx',
        'json',
        'typescript',
        'tsx',
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
