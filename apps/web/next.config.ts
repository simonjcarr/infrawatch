import type { NextConfig } from 'next'
import { getTrustedOriginHosts } from './lib/security/trusted-origins'

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Limit referrer information leakage
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Restrict powerful browser APIs — expand as needed
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Basic CSP — upgrade to nonce-based strict-dynamic before GA
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // TODO: tighten to 'unsafe-inline' removal + nonce once all inline scripts use nonces
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: getTrustedOriginHosts(),
    },
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
