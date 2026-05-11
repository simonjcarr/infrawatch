import 'server-only'

export interface AnsibleApiHealth {
  ok: boolean
  provider: 'ansible'
  ansibleVersion?: string
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
