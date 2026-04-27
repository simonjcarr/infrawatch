import { db } from '@/lib/db'
import { auditEvents } from '@/lib/db/schema'
import { buildAuditEventValues, type AuditEventInput } from './events-core'
export { buildAuditEventValues, serialiseAuditMetadata } from './events-core'

type AuditEventWriter = Pick<typeof db, 'insert'>

export async function writeAuditEvent(executor: AuditEventWriter, input: AuditEventInput): Promise<void> {
  await executor.insert(auditEvents).values(buildAuditEventValues(input))
}
