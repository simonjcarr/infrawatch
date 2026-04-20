// Background worker for the support AI portal.
// Run via: pnpm support:worker
//
// Polls the support_ai_job table with FOR UPDATE SKIP LOCKED, runs the AI turn
// for the ticket, and updates the row. No Redis required — fits the air-gap
// story.

import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { supportAiJobs } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { runAiTurn } from '@/lib/support/ai'

const POLL_MS = env.supportWorkerPollMs
const MAX_ATTEMPTS = 3
const WORKER_ID = `worker-${process.pid}-${Date.now()}`

async function claimOneJob(): Promise<{ id: string; ticketId: string; attempts: number } | null> {
  // Atomic claim: pick the oldest queued row, mark it running, return it.
  const rows = await db.execute<{
    id: string
    ticket_id: string
    attempts: number
  }>(sql`
    UPDATE ${supportAiJobs}
    SET status = 'running',
        locked_by = ${WORKER_ID},
        locked_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM ${supportAiJobs}
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, ticket_id, attempts
  `)
  const first = Array.isArray(rows) ? rows[0] : (rows as { rows: unknown[] }).rows?.[0]
  if (!first) return null
  const row = first as { id: string; ticket_id: string; attempts: number }
  return { id: row.id, ticketId: row.ticket_id, attempts: row.attempts }
}

async function markDone(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE ${supportAiJobs}
    SET status = 'done', updated_at = NOW(), locked_by = NULL, locked_at = NULL
    WHERE id = ${id}
  `)
}

async function markFailed(id: string, attempts: number, err: string): Promise<void> {
  const nextStatus = attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'queued'
  await db.execute(sql`
    UPDATE ${supportAiJobs}
    SET status = ${nextStatus},
        attempts = attempts + 1,
        last_error = ${err},
        updated_at = NOW(),
        locked_by = NULL,
        locked_at = NULL
    WHERE id = ${id}
  `)
}

let stopping = false

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const job = await claimOneJob()
      if (!job) {
        await sleep(POLL_MS)
        continue
      }
      try {
        const outcome = await runAiTurn(job.ticketId)
        if (outcome.kind === 'error') {
          await markFailed(job.id, job.attempts, outcome.reason)
        } else {
          await markDone(job.id)
        }
        console.log(`[support.worker] ${job.id} → ${outcome.kind}${'reason' in outcome ? ` (${outcome.reason})` : ''}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[support.worker] ${job.id} threw:`, msg)
        await markFailed(job.id, job.attempts, msg)
      }
    } catch (err) {
      console.error('[support.worker] poll loop error:', err)
      await sleep(POLL_MS)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function installSignalHandlers(): void {
  const shutdown = (sig: string) => {
    console.log(`[support.worker] ${sig} received, shutting down…`)
    stopping = true
    setTimeout(() => process.exit(0), POLL_MS + 500)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

async function main(): Promise<void> {
  installSignalHandlers()
  console.log(`[support.worker] starting ${WORKER_ID} (poll=${POLL_MS}ms, repo=${env.supportGithubRepo})`)
  if (!env.anthropicApiKey) {
    console.warn('[support.worker] ANTHROPIC_API_KEY not set — worker will mark jobs as failed')
  }
  await loop()
}

main().catch((err) => {
  console.error('[support.worker] fatal:', err)
  process.exit(1)
})
