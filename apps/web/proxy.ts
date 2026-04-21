import { NextRequest, NextResponse } from 'next/server'
import { createRateLimiter } from '@/lib/rate-limit'

// Cookie set by Better Auth on sign-in
const SESSION_COOKIE = 'better-auth.session_token'

const AUTH_ROUTES = ['/login', '/register']

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
const authRateLimit = createRateLimiter(60_000, 10)

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value
  const isAuthenticated = !!sessionToken

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r))
  const isProtectedRoute = PROTECTED_PATHS.some(
    (r) => pathname === r || pathname.startsWith(r + '/'),
  )

  // Honour an upstream-supplied request ID (load balancer, proxy) or generate one.
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // Rate-limit credential-bearing auth endpoints to prevent brute-force attacks.
  if (
    request.method === 'POST' &&
    BETTER_AUTH_SENSITIVE_PATHS.some((p) => pathname.startsWith(p))
  ) {
    if (!authRateLimit.check(ip)) {
      const limitResponse = NextResponse.json(
        { error: 'Too many requests — please wait before trying again.' },
        { status: 429 },
      )
      limitResponse.headers.set('X-Request-Id', requestId)
      return limitResponse
    }
  }

  if (!isAuthenticated && isProtectedRoute) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url))
    redirectResponse.headers.set('X-Request-Id', requestId)
    return redirectResponse
  }

  void isAuthRoute

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  // Echo the ID back to the client so it appears in browser DevTools / client logs.
  response.headers.set('X-Request-Id', requestId)
  return response
}

export const config = {
  // Include /api/auth so the rate limiter above applies to sign-in and
  // password-reset endpoints. Auth-redirect logic only fires for PROTECTED_PATHS
  // (page routes), so API routes are unaffected.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
