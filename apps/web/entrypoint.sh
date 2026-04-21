#!/bin/sh
set -e

# Fail fast if critical environment variables are missing.
# Silent fallbacks (empty DATABASE_URL, empty auth secret, etc.) produce
# subtle, hard-to-diagnose failures that surface only at first use.
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET must be set}"
: "${BETTER_AUTH_URL:?BETTER_AUTH_URL must be set}"

# Ensure the agent-dist volume mount is writable by the nextjs user.
# Docker named volumes are created as root; this fixes ownership on each start.
if [ -d "/var/lib/infrawatch/agent-dist" ]; then
  chown -R nextjs:nodejs /var/lib/infrawatch/agent-dist
fi

exec su-exec nextjs sh -c "node migrate.js && node server.js"
