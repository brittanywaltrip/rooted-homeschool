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
  //   /auth/callback      — owns the auth cookies for its own request.
  //     THIS ONE IS LOAD-BEARING, do not remove it. The callback route
  //     builds its own server client and calls exchangeCodeForSession,
  //     which reads the PKCE code-verifier cookie. If the middleware runs
  //     getUser() first and that call fails (stale, chunk-damaged or
  //     already-rotated session cookie), @supabase/ssr calls _removeSession
  //     — and _removeSession deletes `<storageKey>-code-verifier` along
  //     with the session. The verifier is then gone before the route
  //     handler ever runs, and the family lands on
  //     /login?error=pkce_cross_device. Reproduced against production on
  //     2026-08-18. It also signs out families who arrived holding a stale
  //     cookie, which is why 22 existing users were ejected mid-session.
  //   /api/auth/*         — server-side sign-in. Same reason as
  //     /auth/callback above: the route builds its own server client and
  //     writes the session cookies for its own request. If the middleware
  //     runs getUser() first with the family's stale cookie, @supabase/ssr
  //     calls _removeSession and emits Max-Age=0 deletion cookies onto the
  //     same response the login route just wrote fresh cookies onto. The
  //     password was correct, the session was created server-side, and the
  //     family still lands back on /login. Measured in production: 25 cases
  //     in 21 days of one user creating two sessions 17-45s apart.
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
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api/auth/') ||
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
  // The PKCE code-verifier cookie is literally named
  // `<storageKey>-auth-token-code-verifier`, so a naive startsWith('sb-')
  // + includes('auth-token') test matches it and lets a mid-OAuth visitor
  // through to getUser() with no session to refresh. Exclude it explicitly.
  const hasAuthCookie = request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.startsWith('sb-') &&
        c.name.includes('auth-token') &&
        !c.name.includes('code-verifier'),
    )
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
  //
  // The try/catch adds no statements between them; it only stops ONE crash
  // class from becoming an error page. A corrupted CHUNKED auth cookie
  // (sb-auth-auth-token.0 holding garbage) makes @supabase/ssr throw while it
  // reassembles and base64-decodes the chunks, and an uncaught throw in edge
  // middleware is a 500 MIDDLEWARE_INVOCATION_FAILED page instead of the app.
  // Garbage in a SINGLE unchunked cookie is handled and returns cleanly; only
  // the chunked shape throws. Verified identical on staging and production.
  //
  // This matters because a half-written cookie is exactly what WKWebView
  // leaves behind when iOS kills the suspended app, so the family most likely
  // to hit it is the one lib/session-lifeboat.ts exists to rescue, and a 500
  // denies them that rescue: the page never loads, so no client code runs.
  try {
    await supabase.auth.getUser()
  } catch (err) {
    // Edge runtime. A plain console.error keeps the edge bundle lean; do not
    // import Sentry here. The prefix is what makes this greppable in the
    // Vercel runtime logs.
    console.error(
      '[middleware] auth cookie parse failure:',
      err instanceof Error ? err.message : String(err),
    )
    // Expire the unreadable session cookies so the request completes as a
    // signed-out page load. The client then boots, getUserWithRetry finds no
    // session, and restoreFromLifeboat puts the family straight back in, so
    // the crash becomes an invisible self-heal rather than an error page.
    //
    // A fresh response, not supabaseResponse: setAll() may have already
    // rebuilt that one with half-written cookies from the failed parse.
    const healed = NextResponse.next({ request })
    for (const cookie of request.cookies.getAll()) {
      if (!cookie.name.startsWith('sb-')) continue
      // Same exclusion as the herd guard above, for the same reason. The PKCE
      // verifier is literally named `<storageKey>-auth-token-code-verifier`,
      // so a blanket `sb-` sweep deletes it too, and a family mid-OAuth then
      // reaches /auth/callback with no verifier and lands on
      // /login?error=pkce_cross_device unable to finish signing in.
      if (cookie.name.includes('code-verifier')) continue
      // The domain has to match the one the cookie was written with or the
      // deletion silently targets a different cookie and the bad one survives.
      healed.cookies.set(cookie.name, '', {
        maxAge: 0,
        path: '/',
        ...(runtimeDomain ? { domain: runtimeDomain } : {}),
      })
    }
    return healed
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
