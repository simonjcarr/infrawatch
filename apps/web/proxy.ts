import { NextRequest, NextResponse } from 'next/server'
import { hasBetterAuthSessionCookie } from '@/lib/auth/session-cookie-names'
import { getClientIpFromHeaders } from '@/lib/client-ip'
import { buildContentSecurityPolicy } from '@/lib/security/csp'

const AUTH_ROUTES = ['/login', '/register']
const SETUP_ROUTES = ['/pending-approval', '/seat-limit-exceeded', '/setup-email', '/check-email']
const NO_STORE_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate'

const PROTECTED_PATHS = [
  '/dashboard',
  '/hosts',
  '/alerts',
  '/certificates',
  '/service-accounts',
  '/bundlers',
  '/runbooks',
  '/tasks',
  '/team',
  '/settings',
  '/profile',
]

// Credential-bearing Better Auth paths — brute-force and token-stuffing targets.
// 10 POST requests per IP per 60 s is generous for legitimate users but stops
// automated attacks quickly. Multi-node deployments should use Redis instead.
const BETTER_AUTH_SENSITIVE_PATHS = [
  '/api/auth/sign-in',
  '/api/auth/forget-password',
  '/api/auth/reset-password',
]
const authRateLimitHits = new Map<string, number[]>()

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

function checkAuthRateLimit(ip: string, now = Date.now()): boolean {
  const cutoff = now - 60_000
  const hits = (authRateLimitHits.get(ip) ?? []).filter((timestamp) => timestamp > cutoff)
  if (hits.length >= 10) return false
  hits.push(now)
  authRateLimitHits.set(ip, hits)
  return true
}

function applyCommonSecurityHeaders(response: NextResponse, requestId: string, csp: string): NextResponse {
  response.headers.set('X-Request-Id', requestId)
  response.headers.set('Content-Security-Policy', csp)
  return response
}

function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', NO_STORE_CACHE_CONTROL)
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthenticated = hasBetterAuthSessionCookie(request.cookies)

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r))
  const isSetupRoute = SETUP_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
  const isProtectedRoute = PROTECTED_PATHS.some(
    (r) => pathname === r || pathname.startsWith(r + '/'),
  )
  const isSessionScopedRoute = isAuthRoute || isSetupRoute || isProtectedRoute || pathname.startsWith('/api/auth/')

  // Honour an upstream-supplied request ID (load balancer, proxy) or generate one.
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const nonce = generateNonce()
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'development')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-pathname', pathname)
  requestHeaders.set('Content-Security-Policy', csp)

  const ip = getClientIpFromHeaders(request.headers)

  // Rate-limit credential-bearing auth endpoints to prevent brute-force attacks.
  if (
    request.method === 'POST' &&
    BETTER_AUTH_SENSITIVE_PATHS.some((p) => pathname.startsWith(p))
  ) {
    if (!checkAuthRateLimit(ip)) {
      const limitResponse = NextResponse.json(
        { error: 'Too many requests — please wait before trying again.' },
        { status: 429 },
      )
      applyCommonSecurityHeaders(limitResponse, requestId, csp)
      return applyNoStoreHeaders(limitResponse)
    }
  }

  if (!isAuthenticated && isProtectedRoute) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url))
    applyCommonSecurityHeaders(redirectResponse, requestId, csp)
    return applyNoStoreHeaders(redirectResponse)
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  // Echo the ID back to the client so it appears in browser DevTools / client logs.
  applyCommonSecurityHeaders(response, requestId, csp)
  if (isSessionScopedRoute) {
    applyNoStoreHeaders(response)
  }
  return response
}

export const config = {
  // Include /api/auth so the rate limiter above applies to sign-in and
  // password-reset endpoints. Auth-redirect logic only fires for PROTECTED_PATHS
  // (page routes), so API routes are unaffected.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
