# Feature Flags

CT-Ops uses feature flags to ship dormant code without exposing unfinished workflows in production.

Developers define known flags in code. Each CT-Ops instance stores explicit opt-ins in `instance_settings.metadata.featureFlags`. Missing flags are treated as disabled, and unknown flags fail closed.

The database stores only the instance choice:

```json
{
  "featureFlags": {
    "automation.ansible": true
  }
}
```

Feature flags are not a security boundary by themselves. CT-Ops checks them in the backend before changing data or enabling provider-specific behaviour. Frontend checks only control visibility and user experience.

## Ansible Automation

`automation.ansible` gates the optional Ansible automation provider. The flag is off by default.

Administrators enable it from **Settings → Integrations → Automation**. CT-Ops stores both the feature flag and the selected automation provider in the database:

```json
{
  "featureFlags": {
    "automation.ansible": true
  },
  "automationSettings": {
    "provider": "ansible"
  }
}
```

CT-Ops does not start Docker containers from the web app. After enabling or disabling Ansible, an operator must run:

```bash
./start.sh
```

The start script reads the database after migrations and starts the optional `ansible-api` Compose profile only when both the flag and provider are enabled.
