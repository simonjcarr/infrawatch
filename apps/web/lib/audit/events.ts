import { auditEvents } from '@/lib/db/schema'
import { buildAuditEventValues, type AuditEventInput } from './events-core'
export { buildAuditEventValues, serialiseAuditMetadata } from './events-core'

export async function writeAuditEvent(executor: any, input: AuditEventInput): Promise<void> {
  await executor.insert(auditEvents).values(buildAuditEventValues(input))
}
