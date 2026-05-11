import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const sources = {
  'alerts.ts': readFileSync(path.join(here, 'alerts.ts'), 'utf8'),
  'automation.ts': readFileSync(path.join(here, 'automation.ts'), 'utf8'),
  'checks-core.ts': readFileSync(path.join(here, 'checks-core.ts'), 'utf8'),
  'host-groups-core.ts': readFileSync(path.join(here, 'host-groups-core.ts'), 'utf8'),
  'host-groups.ts': readFileSync(path.join(here, 'host-groups.ts'), 'utf8'),
  'host-settings.ts': readFileSync(path.join(here, 'host-settings.ts'), 'utf8'),
  'tag-rules.ts': readFileSync(path.join(here, 'tag-rules.ts'), 'utf8'),
  'tags-core.ts': readFileSync(path.join(here, 'tags-core.ts'), 'utf8'),
  'tags.ts': readFileSync(path.join(here, 'tags.ts'), 'utf8'),
}

function getActionSegment(fileName, action) {
  const source = sources[fileName]
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in ${fileName}`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

const writeGuardedActions = [
  ['alerts.ts', 'createAlertRule'],
  ['alerts.ts', 'updateAlertRule'],
  ['alerts.ts', 'deleteAlertRule'],
  ['alerts.ts', 'acknowledgeAlert'],
  ['alerts.ts', 'createSilence'],
  ['alerts.ts', 'deleteSilence'],
  ['checks-core.ts', 'createCheck'],
  ['checks-core.ts', 'updateCheck'],
  ['checks-core.ts', 'deleteCheckHistory'],
  ['checks-core.ts', 'deleteCheck'],
  ['host-groups-core.ts', 'createGroup'],
  ['host-groups-core.ts', 'updateGroup'],
  ['host-groups-core.ts', 'deleteGroup'],
  ['host-groups-core.ts', 'addHostToGroup'],
  ['host-groups-core.ts', 'removeHostFromGroup'],
  ['host-settings.ts', 'updateHostCollectionSettings'],
  ['tag-rules.ts', 'bulkAssignTags'],
  ['tag-rules.ts', 'runTagRule'],
  ['tag-rules.ts', 'runMatchingTagRules'],
  ['tags-core.ts', 'assignTagsToResource'],
  ['tags-core.ts', 'removeTagFromResource'],
  ['tags-core.ts', 'replaceResourceTags'],
]

const adminGuardedActions = [
  ['alerts.ts', 'createGlobalAlertDefault'],
  ['alerts.ts', 'deleteGlobalAlertDefault'],
  ['alerts.ts', 'applyGlobalDefaultsToHost'],
  ['automation.ts', 'updateAnsibleAutomationSettings'],
  ['host-settings.ts', 'updateOrgDefaultCollectionSettings'],
  ['tag-rules.ts', 'createTagRule'],
  ['tag-rules.ts', 'updateTagRule'],
  ['tag-rules.ts', 'deleteTagRule'],
  ['tags-core.ts', 'updateOrgDefaultTags'],
]

test('instance state mutations require write-capable org access', () => {
  for (const [fileName, action] of writeGuardedActions) {
    const segment = getActionSegment(fileName, action)

    assert.match(
      segment,
      /(?:const session = )?await requireInstanceWriteAccess\((?:instanceId|currentScope)\)/,
      `${fileName} ${action} must reject read-only users before mutating instance state`,
    )
  }
})

test('instance-wide defaults and rules require org admin access', () => {
  for (const [fileName, action] of adminGuardedActions) {
    const segment = getActionSegment(fileName, action)

    assert.match(
      segment,
      /(?:const session = )?await requireInstanceAdminAccess\((?:instanceId|currentScope)\)/,
      `${fileName} ${action} must require org admin access before mutating instance-wide settings`,
    )
  }
})
