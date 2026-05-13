import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, 'docker-containers.ts'), 'utf8')

function getActionSegment(action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in docker-containers.ts`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('getHostDockerContainerMetrics validates host and container scope before querying metrics', () => {
  const segment = getActionSegment('getHostDockerContainerMetrics')
  const hostLookupIndex = segment.indexOf('db.query.hosts.findFirst')
  const containerLookupIndex = segment.indexOf('db.query.dockerContainers.findFirst')
  const metricQueryIndex = segment.indexOf('FROM docker_container_metrics')

  assert.notEqual(hostLookupIndex, -1, 'host ownership must be validated')
  assert.notEqual(containerLookupIndex, -1, 'container ownership must be validated')
  assert.notEqual(metricQueryIndex, -1, 'metrics must be queried only after scope checks')
  assert.ok(hostLookupIndex < metricQueryIndex, 'host validation must run before metric query')
  assert.ok(containerLookupIndex < metricQueryIndex, 'container validation must run before metric query')
  assert.match(segment, /eq\(hosts\.instanceId, instanceId\)/, 'host lookup must be scoped to the caller instance')
  assert.match(segment, /eq\(dockerContainers\.instanceId, instanceId\)/, 'container lookup must be scoped to the caller instance')
  assert.match(segment, /eq\(dockerContainers\.hostId, hostId\)/, 'container lookup must be scoped to the host')
})

test('getHostDockerContainerMetrics returns bucketed averages and maxima for spike visibility', () => {
  const segment = getActionSegment('getHostDockerContainerMetrics')

  assert.match(segment, /AVG\(cpu_percent\).*AS cpu_avg/s)
  assert.match(segment, /MAX\(cpu_percent\).*AS cpu_max/s)
  assert.match(segment, /AVG\(memory_percent\).*AS memory_avg/s)
  assert.match(segment, /MAX\(memory_percent\).*AS memory_max/s)
  assert.match(segment, /AVG\(network_rx_bytes\).*AS network_rx_avg/s)
  assert.match(segment, /MAX\(network_rx_bytes\).*AS network_rx_max/s)
  assert.match(segment, /AVG\(block_read_bytes\).*AS block_read_avg/s)
  assert.match(segment, /MAX\(block_read_bytes\).*AS block_read_max/s)
  assert.match(segment, /AVG\(pids_current\).*AS pids_avg/s)
  assert.match(segment, /MAX\(pids_current\).*AS pids_max/s)
  assert.match(segment, /LIMIT \$\{MAX_METRIC_POINTS\}/, 'metric query must cap returned points')
})
