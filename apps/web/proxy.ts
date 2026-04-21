import { NextRequest, NextResponse } from 'next/server'

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

  if (!isAuthenticated && isProtectedRoute) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url))
    redirectResponse.headers.set('X-Request-Id', requestId)
    return redirectResponse
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  // Echo the ID back to the client so it appears in browser DevTools / client logs.
  response.headers.set('X-Request-Id', requestId)
  return response
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
