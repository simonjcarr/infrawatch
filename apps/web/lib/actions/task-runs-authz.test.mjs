import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const taskRunsSource = readFileSync(path.join(here, 'task-runs-core.ts'), 'utf8')
const taskSchedulesSource = readFileSync(path.join(here, 'task-schedules-core.ts'), 'utf8')

function getActionSegment(source, action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

const privilegedTaskRunActions = [
  'triggerCustomScriptRun',
  'triggerGroupCustomScriptRun',
  'triggerServiceAction',
  'triggerGroupServiceAction',
  'triggerAgentUninstall',
  'triggerPatchRun',
  'triggerGroupPatchRun',
]

test('privileged host task actions require org admin access and derive actors from session', () => {
  for (const action of privilegedTaskRunActions) {
    const segment = getActionSegment(taskRunsSource, action)

    assert.doesNotMatch(
      segment.slice(0, segment.indexOf('): Promise')),
      /\buserId\s*:/,
      `${action} must not accept caller-controlled userId`,
    )
    assert.match(
      segment,
      /const session = await requireOrgAdminAccess\(currentScope\)/,
      `${action} must capture an org-admin-authorized session`,
    )
    assert.match(
      segment,
      /session\.user\.id/,
      `${action} must write task actor fields from session.user.id`,
    )
  }
})

test('privileged task schedule mutations require org admin access', () => {
  for (const action of ['createSchedule', 'updateSchedule', 'runScheduleNow']) {
    const segment = getActionSegment(taskSchedulesSource, action)

    assert.match(
      segment,
      /(?:const session = )?await requireOrgAdminAccess\(currentScope\)/,
      `${action} must require org admin access before mutating privileged schedules`,
    )
  }
})
