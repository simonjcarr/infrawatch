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

  if (!isAuthenticated && isProtectedRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
