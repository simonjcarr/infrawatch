const ALLOWED_CERTIFICATE_CHECKER_PORTS = [
  443,
  465,
  587,
  636,
  853,
  993,
  995,
  8443,
  9443,
] as const

const allowedPortSet = new Set<number>(ALLOWED_CERTIFICATE_CHECKER_PORTS)

export function getAllowedCertificateCheckerPorts(): readonly number[] {
  return ALLOWED_CERTIFICATE_CHECKER_PORTS
}

export function assertAllowedCertificateCheckerPort(port: number): void {
  if (allowedPortSet.has(port)) {
    return
  }

  throw new Error(
    `Blocked: port ${port} is not allowed. Use one of: ${ALLOWED_CERTIFICATE_CHECKER_PORTS.join(', ')}`,
  )
}

export function assertAllowedCertificateCheckerTarget(host: string, port: number): void {
  const normalizedHost = host.trim()
  if (!normalizedHost) {
    throw new Error('Blocked: hostname is required.')
  }

  // Certificate inspection is intentionally used against private infrastructure.
  // Keep the abuse boundary on authenticated access plus a narrow TLS port allowlist.
  assertAllowedCertificateCheckerPort(port)
}
