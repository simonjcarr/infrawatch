import 'server-only'

import {
  getModuleConnectionRuntime,
  getModuleConnectionSummary,
  saveModuleConnection,
  type ModuleConnectionInput,
  type ModuleConnectionRuntime,
  type ModuleConnectionSummary,
} from '@/lib/modules/module-connections'
import { buildSignedModuleRequestHeaders } from '@/lib/modules/service-token'
import { buildAnsiblePairingConnectionInput, ANSIBLE_PAIRING_TIMEOUT_MS } from './ansible-pairing-core'

export interface AnsibleApiHealth {
  ok: boolean
  provider: 'ansible'
  ansibleVersion?: string
}

export interface RunAnsiblePingRequest {
  credential: {
    username: string
    privateKey: string
  }
  hosts: Array<{
    id: string
    name: string
    address: string
    port: number
  }>
}

export interface RunAnsiblePingHostResult {
  id: string
  name: string
  status: 'success' | 'failed'
  exitCode: number
  stdout: string
  stderr: string
}

export interface RunAnsiblePingResponse {
  ok: boolean
  elapsedMs: number
  hosts: RunAnsiblePingHostResult[]
}

export interface PairAnsibleApiInput {
  baseUrl: string
  username: string
  password: string
}

export function getAnsibleApiBaseUrl(): string {
  return (process.env['ANSIBLE_API_URL'] ?? 'http://ansible-api:8080').replace(/\/+$/, '')
}

function defaultAnsibleConnection(instanceId: string): ModuleConnectionRuntime {
  const now = new Date(0)
  return {
    id: 'env:ansible-api',
    instanceId,
    moduleType: 'ansible',
    enabled: true,
    name: 'Primary Ansible API',
    baseUrl: getAnsibleApiBaseUrl(),
    contractVersion: 'legacy-env',
    authMode: 'none',
    tokenId: null,
    hasTokenSecret: false,
    tokenSecret: null,
    tlsMode: 'insecure',
    caCertificate: null,
    serverCertificateSha256: null,
    timeoutMs: 5000,
    createdAt: now,
    updatedAt: now,
  }
}

export async function getAnsibleModuleConnectionSummary(
  instanceId: string,
): Promise<ModuleConnectionSummary> {
  const stored = await getModuleConnectionSummary(instanceId, 'ansible')
  if (stored) return stored
  const fallback = defaultAnsibleConnection(instanceId)
  return {
    ...fallback,
    hasTokenSecret: false,
  }
}

async function getAnsibleModuleConnectionRuntime(instanceId: string): Promise<ModuleConnectionRuntime> {
  return await getModuleConnectionRuntime(instanceId, 'ansible') ?? defaultAnsibleConnection(instanceId)
}

export async function saveAnsibleModuleConnection(
  instanceId: string,
  input: Omit<ModuleConnectionInput, 'moduleType'>,
): Promise<ModuleConnectionSummary> {
  return saveModuleConnection(instanceId, {
    ...input,
    moduleType: 'ansible',
  })
}

export async function pairAnsibleApi(
  instanceId: string,
  input: PairAnsibleApiInput,
): Promise<ModuleConnectionSummary> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANSIBLE_PAIRING_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/api/v1/pairing/claim`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : `Ansible API returned ${response.status}`
      throw new Error(message)
    }
    if (
      data?.ok !== true ||
      typeof data.tokenId !== 'string' ||
      typeof data.tokenSecret !== 'string'
    ) {
      throw new Error('Invalid Ansible pairing response')
    }

    return saveAnsibleModuleConnection(instanceId, buildAnsiblePairingConnectionInput({
      baseUrl,
      tokenId: data.tokenId,
      tokenSecret: data.tokenSecret,
    }))
  } finally {
    clearTimeout(timeout)
  }
}

function requestHeaders(connection: ModuleConnectionRuntime, method: string, path: string, body: string | Buffer = '') {
  if (connection.authMode !== 'service-token-hmac') return {}
  if (!connection.tokenId || !connection.tokenSecret) {
    throw new Error('Ansible module connection is missing service-token credentials')
  }
  return buildSignedModuleRequestHeaders({
    method,
    path,
    body,
    token: {
      id: connection.tokenId,
      secret: connection.tokenSecret,
    },
  })
}

export async function checkAnsibleApiHealth(instanceId: string): Promise<AnsibleApiHealth | null> {
  const connection = await getAnsibleModuleConnectionRuntime(instanceId)
  if (!connection.enabled) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(connection.timeoutMs, 10_000))

  try {
    const path = '/healthz'
    const response = await fetch(`${connection.baseUrl}${path}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: requestHeaders(connection, 'GET', path),
    })
    if (!response.ok) return null

    const data = await response.json()
    if (data?.provider !== 'ansible' || data?.ok !== true) return null

    return {
      ok: true,
      provider: 'ansible',
      ansibleVersion: typeof data.ansibleVersion === 'string' ? data.ansibleVersion : undefined,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function runAnsiblePing(
  instanceId: string,
  payload: RunAnsiblePingRequest,
): Promise<RunAnsiblePingResponse> {
  const connection = await getAnsibleModuleConnectionRuntime(instanceId)
  if (!connection.enabled) throw new Error('Ansible module connection is disabled')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(connection.timeoutMs, 60_000), 120_000))

  try {
    const path = '/api/v1/runs/ansible-ping'
    const body = JSON.stringify(payload)
    const response = await fetch(`${connection.baseUrl}${path}`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...requestHeaders(connection, 'POST', path, body),
      },
      body,
    })

    if (!response.ok) {
      throw new Error(`Ansible API returned ${response.status}`)
    }

    const data = await response.json()
    if (!data || !Array.isArray(data.hosts)) throw new Error('Invalid Ansible API response')

    return {
      ok: data.ok === true,
      elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : 0,
      hosts: data.hosts.map((host: Record<string, unknown>) => ({
        id: String(host['id'] ?? ''),
        name: String(host['name'] ?? ''),
        status: host['status'] === 'success' ? 'success' : 'failed',
        exitCode: typeof host['exitCode'] === 'number' ? host['exitCode'] : 1,
        stdout: typeof host['stdout'] === 'string' ? host['stdout'] : '',
        stderr: typeof host['stderr'] === 'string' ? host['stderr'] : '',
      })),
    }
  } finally {
    clearTimeout(timeout)
  }
}
