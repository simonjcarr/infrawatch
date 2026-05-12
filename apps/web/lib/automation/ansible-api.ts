import 'server-only'

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

export function getAnsibleApiBaseUrl(): string {
  return (process.env['ANSIBLE_API_URL'] ?? 'http://ansible-api:8080').replace(/\/+$/, '')
}

export async function checkAnsibleApiHealth(): Promise<AnsibleApiHealth | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)

  try {
    const response = await fetch(`${getAnsibleApiBaseUrl()}/healthz`, {
      cache: 'no-store',
      signal: controller.signal,
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
  payload: RunAnsiblePingRequest,
): Promise<RunAnsiblePingResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const response = await fetch(`${getAnsibleApiBaseUrl()}/api/v1/runs/ansible-ping`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
