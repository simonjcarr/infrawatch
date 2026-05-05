#!/usr/bin/env node
/**
 * Validates that migration journal timestamps are strictly monotonic.
 *
 * Drizzle's migrator skips migrations whose `when` timestamp is earlier than
 * an already-applied migration. This script catches that before it reaches
 * a running container.
 *
 * Usage:
 *   node scripts/validate-migrations.js          # exits 0 on success, 1 on failure
 *   pnpm run db:validate                          # via package.json script
 */

const fs = require('fs')
const path = require('path')

const JOURNAL_PATH = path.resolve(
  __dirname,
  '../lib/db/migrations/meta/_journal.json'
)
const SNAPSHOT_DIR = path.dirname(JOURNAL_PATH)

function validate() {
  if (!fs.existsSync(JOURNAL_PATH)) {
    console.error('Migration journal not found at', JOURNAL_PATH)
    process.exit(1)
  }

  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8'))
  const entries = journal.entries

  if (!entries || entries.length === 0) {
    console.log('No migration entries found.')
    return
  }

  const errors = []

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const curr = entries[i]

    if (curr.when <= prev.when) {
      errors.push(
        `Migration ${curr.idx} "${curr.tag}" (when: ${curr.when}) has a timestamp <= ` +
          `migration ${prev.idx} "${prev.tag}" (when: ${prev.when}). ` +
          `The migrator will skip it.`
      )
    }
  }

  const latest = entries[entries.length - 1]
  const latestPrefix = String(latest.idx).padStart(4, '0')
  const latestSnapshotPath = path.join(
    SNAPSHOT_DIR,
    `${latestPrefix}_snapshot.json`
  )

  if (!fs.existsSync(latestSnapshotPath)) {
    errors.push(
      `Latest migration ${latest.idx} "${latest.tag}" has no matching ` +
        `${latestPrefix}_snapshot.json. Drizzle may re-emit already-applied ` +
        'schema changes as drift.'
    )
  }

  if (errors.length > 0) {
    console.error('Migration journal validation FAILED:\n')
    errors.forEach((e) => console.error(`  - ${e}`))
    console.error(
      '\nFix: ensure journal timestamps are strictly increasing and the latest migration has a matching snapshot.'
    )
    process.exit(1)
  }

  console.log(
    `Migration journal OK: ${entries.length} entries, timestamps strictly increasing.`
  )
}

validate()
