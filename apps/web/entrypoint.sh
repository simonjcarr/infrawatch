#!/bin/sh
set -e

# Fail fast if critical environment variables are missing.
# Silent fallbacks (empty auth secret, missing database credentials, etc.)
# produce subtle, hard-to-diagnose failures that surface only at first use.
if [ -z "${DATABASE_URL:-}" ]; then
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set when DATABASE_URL is not set}"
fi
: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET must be set}"
: "${BETTER_AUTH_URL:?BETTER_AUTH_URL must be set}"

AGENT_DIST_DIR="${AGENT_DIST_DIR:-./data/agent-dist}"

# The web container no longer starts as root. If operators mount a custom
# agent bundle directory, it must already be writable by uid/gid 1001.
mkdir -p "$AGENT_DIST_DIR"
if [ ! -w "$AGENT_DIST_DIR" ]; then
  echo "AGENT_DIST_DIR is not writable: $AGENT_DIST_DIR" >&2
  echo "Pre-create the directory or volume with uid/gid 1001 (nextjs:nodejs)." >&2
  exit 1
fi

exec sh -c "node migrate.js && node server.js"
