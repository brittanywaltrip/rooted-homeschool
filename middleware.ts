import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Bypass auth middleware for Stripe webhooks and API routes
  if (
    pathname.startsWith('/api/stripe/webhook') ||
    pathname.startsWith('/api/webhook') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/cron')
  ) {
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/stripe/webhook',
    '/api/webhook',
    '/api/webhooks',
    '/api/cron',
  ],
}
