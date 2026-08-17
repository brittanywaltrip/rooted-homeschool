import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getCookieDomain } from '@/lib/cookie-domain'

// Standard @supabase/ssr middleware pattern. Runs on every request that
// the matcher below lets through and calls supabase.auth.getUser(),
// which is what triggers an access-token refresh from the refresh
// token cookie. Before this fix the middleware was a no-op, so iOS
// PWA users lost their session the moment the ~1-hour access token
// expired (Safari's ITP doesn't keep them alive on its own).
//
// IMPORTANT — auth file manifest:
// This file now performs Supabase session handling, so it joins the
// CLAUDE.md auth file manifest (callback route, supabase clients,
// cookie-domain, login/signup/onboarding, dashboard layout). Any change
// here must clear the OAuth + onboarding smoke test on staging before
// merging to main.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Bypass session refresh for routes that authenticate by other means
  // or are intentionally for unauthenticated visitors:
  //   /api/stripe/webhook — Stripe-Signature header verification
  //   /api/cron           — Vercel cron secret
  //   /family/*           — token-based public viewer for grandparents
  //   /ingest, /monitoring — PostHog + Sentry proxies (next.config rewrites).
  //     These fire constantly from every open tab and are the single
  //     biggest source of redundant refreshes. See the herd note below.
  //   /sw.js, /manifest.json — static PWA assets, no session needed.
  // Doing auth work here would be wasted overhead at best and could
  // interfere with the family viewer's anon-by-design flow.
  if (
    pathname.startsWith('/api/stripe/webhook') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/family') ||
    pathname.startsWith('/ingest') ||
    pathname.startsWith('/monitoring') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next()
  }

  // ── Refresh-token herd guard ───────────────────────────────────────────
  // Every middleware invocation that reaches getUser() below independently
  // rotates the refresh token. A single page load can fan out into a dozen
  // edge invocations, and when the ~1h access token has expired they all
  // refresh in the same second. Supabase rotates on first use, so the
  // stragglers come back "Invalid Refresh Token" — and @supabase/ssr
  // responds to an auth error by writing Max-Age=0 deletion cookies, which
  // wipes the session the winners just refreshed. The family is bounced to
  // /login with a perfectly good password. Two cheap guards:
  //
  // 1. No Supabase auth cookie means there is no session to refresh.
  //    Signed-out visitors on marketing pages should never touch auth.
  // 2. Router prefetches are speculative. Next fires them for links the
  //    family may never click, and a token rotation triggered by a link
  //    they merely hovered is pure downside.
  //
  // Real document navigations and RSC fetches still refresh normally, so
  // long sessions stay alive. Do NOT widen this to skip all non-document
  // requests: client-side navigation in the dashboard is an RSC fetch, and
  // skipping those would starve the refresh and reintroduce the original
  // expiry bug this middleware was written to fix.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (!hasAuthCookie) {
    return NextResponse.next()
  }
  if (request.headers.get('next-router-prefetch') === '1') {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const runtimeDomain = getCookieDomain(request.nextUrl.hostname)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mutate the request's cookie jar so any downstream handler in
          // this same request observes the refreshed session, then rebuild
          // the response so its Set-Cookie headers carry the new values.
          // The full `options` object (domain, path, secure, httpOnly,
          // sameSite, maxAge, expires) is preserved verbatim per the
          // CLAUDE.md auth invariant against stripping cookie options.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
      cookieOptions: runtimeDomain ? { domain: runtimeDomain } : {},
    },
  )

  // IMPORTANT: Do NOT put any logic between createServerClient and
  // getUser(). That call is what reads the refresh token from cookies,
  // mints a new access token, and triggers setAll() above to write the
  // refreshed session cookies onto supabaseResponse. Interleaving any
  // other Supabase call here can race the refresh and drop the session.
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
