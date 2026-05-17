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

CT-Ops does not start Docker containers from the web app or from `./start.sh`.
Administrators pair the Ansible API URL with the initial username and password
configured on the `ansible-api` container. The container then generates a
service-token secret for ongoing signed requests; CT-Ops stores that generated
secret encrypted and does not retain the initial password. The `ansible-api`
container can run on the CT-Ops host, on a different host, or behind a reverse
proxy.

When the API is healthy, administrators can save encrypted SSH private-key credential profiles and run an Ansible ping task from host or host-group task views. CT-Ops stores task state and redacted output in its task history; the Ansible container only executes the requested ping operation.
