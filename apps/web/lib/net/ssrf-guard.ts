import * as dns from 'dns'
import * as net from 'net'

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    const [a = 0, b = 0] = parts
    return (
      a === 127 ||                           // 127.0.0.0/8  loopback
      a === 10 ||                            // 10.0.0.0/8   RFC 1918
      a === 0 ||                             // 0.0.0.0/8    "this" network
      (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12 RFC 1918
      (a === 192 && b === 168) ||            // 192.168.0.0/16 RFC 1918
      (a === 169 && b === 254) ||            // 169.254.0.0/16 link-local
      (a === 100 && b >= 64 && b <= 127)     // 100.64.0.0/10 CGNAT
    )
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase()
    const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1]!)
    return (
      norm === '::1' ||
      norm === '::' ||
      norm.startsWith('fc') ||
      norm.startsWith('fd') ||
      norm.startsWith('fe8') ||
      norm.startsWith('fe9') ||
      norm.startsWith('fea') ||
      norm.startsWith('feb')
    )
  }
  return true
}

/**
 * Resolves hostname to an IP and throws if it falls in a private/reserved range.
 * Also returns the resolved IP so callers can pass it directly to the socket to
 * prevent DNS-rebinding between the check and the actual connection.
 */
export async function assertPublicHost(hostname: string): Promise<string> {
  let resolvedIp: string
  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    resolvedIp = hostname
  } else {
    const { address } = await dns.promises.lookup(hostname)
    resolvedIp = address
  }
  if (isPrivateIp(resolvedIp)) {
    throw new Error(
      `Blocked: target resolves to a private or reserved address (${resolvedIp}). ` +
        'Use a publicly routable hostname.',
    )
  }
  return resolvedIp
}
