import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents.ts'), 'utf8')
const usersSource = readFileSync(path.join(here, 'users.ts'), 'utf8')

function getActionSegment(source, action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

const auditedLifecycleActions = [
  ['users.ts', usersSource, 'inviteUser', ['invitation.created', 'user.restored']],
  ['users.ts', usersSource, 'deactivateUser', ['user.deactivated']],
  ['users.ts', usersSource, 'reactivateUser', ['user.reactivated']],
  ['users.ts', usersSource, 'cancelInvite', ['invitation.cancelled']],
  ['agents.ts', agentsSource, 'approveAgent', ['agent.approved']],
  ['agents.ts', agentsSource, 'rejectAgent', ['agent.rejected']],
  ['agents.ts', agentsSource, 'revokeEnrolmentToken', ['agent.enrolment_token.revoked']],
]

test('privileged lifecycle mutations write central audit events', () => {
  for (const [fileName, source, action, auditActions] of auditedLifecycleActions) {
    const segment = getActionSegment(source, action)

    assert.match(
      segment,
      /writeAuditEvent\(/,
      `${fileName} ${action} must write a central audit event`,
    )

    for (const auditAction of auditActions) {
      assert.match(
        segment,
        new RegExp(`action: '${auditAction.replaceAll('.', '\\.')}'`),
        `${fileName} ${action} must emit ${auditAction}`,
      )
    }
  }
})
