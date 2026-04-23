export interface SecurityOverview {
  serverTls: {
    certFile: string
    subject: string
    issuer: string
    notBefore: string
    notAfter: string
    fingerprintSha256: string
  } | null
  agentCa: {
    source: 'auto' | 'byo'
    subject: string
    issuer: string
    notBefore: string
    notAfter: string
    fingerprintSha256: string
    byoEnvConfigured: boolean
  } | null
}
