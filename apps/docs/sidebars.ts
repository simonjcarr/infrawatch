import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  mainSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/agent',
        'architecture/ingest',
        'architecture/deployment-profiles',
      ],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/hosts',
        'features/host-groups',
        'features/monitoring',
        'features/certificates',
        'features/alerts',
        'features/notifications',
        'features/reports',
        'features/terminal',
        'features/service-accounts',
        'features/tasks',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        'deployment/docker-compose',
        'deployment/air-gap',
      ],
    },
  ],
};

export default sidebars;
