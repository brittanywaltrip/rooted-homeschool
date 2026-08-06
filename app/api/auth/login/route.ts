import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCookieDomain } from '@/lib/cookie-domain'

/**
 * Server-side email/password sign-in.
 *
 * WHY THIS EXISTS: password sign-in used to run in the browser via
 * supabase.auth.signInWithPassword(), so the session cookies were written by
 * JavaScript. Safari caps JS-written (document.cookie) storage at 7 days and
 * evicts it far more aggressively for home-screen web apps, so iPhone users
 * were being signed out multiple times a day. Cookies delivered as HTTP
 * Set-Cookie response headers are durable. Google and Apple sign-in already
 * got server-set cookies through /auth/callback; email/password did not. The
 * server-side sessions themselves were always healthy, so once the cookie
 * survives on the device the user stays logged in.
 *
 * Deliberately mirrors app/auth/callback/route.ts: same createServerClient
 * setup, same dual write into the cookie store and a response, same
 * getCookieDomain() call keyed off the incoming request's hostname, and the
 * same full-options cookie copy onto the returned response.
 *
 * The cookie options are whatever @supabase/ssr hands the adapter, passed
 * through untouched. In particular nothing here sets httpOnly: the browser
 * Supabase client reads the session cookie on every client-side query, so an
 * httpOnly auth cookie would break the app.
 */
export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const runtimeDomain = getCookieDomain(requestUrl.hostname)

  let email: string | undefined
  let password: string | undefined
  try {
    const body = await request.json()
    email = typeof body?.email === 'string' ? body.email : undefined
    password = typeof body?.password === 'string' ? body.password : undefined
  } catch {
    return NextResponse.json({ ok: false, message: 'Something went wrong. Please try again.' })
  }

  if (!email || !password) {
    return NextResponse.json({ ok: false, message: 'Enter your email and password.' })
  }

  const cookieStore = await cookies()
  const supabaseResponse = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
      cookieOptions: runtimeDomain ? { domain: runtimeDomain } : {},
    }
  )

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    // Pass the Supabase message through unchanged so the form shows exactly
    // the same text it always has (e.g. "Invalid login credentials"). No
    // cookies were set on this path, so there is nothing to copy.
    if (error) {
      return NextResponse.json({ ok: false, message: error.message })
    }
    if (!data.user) {
      return NextResponse.json({ ok: false, message: 'Something went wrong. Please try again.' })
    }

    // Same rule the client used to apply: onboarded === false means a new user
    // who hasn't finished setup. maybeSingle + the === false check means a
    // missing profile row is treated as onboarded, matching prior behavior.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarded')
      .eq('id', data.user.id)
      .maybeSingle()

    const redirectTo = profile?.onboarded === false ? '/onboarding' : '/dashboard'

    const response = NextResponse.json({ ok: true, redirectTo })

    // IMPORTANT: preserve full cookie options (especially `domain`) when
    // copying from supabaseResponse onto the JSON response. Dropping the
    // domain option scopes cookies to the response host instead of the apex
    // wildcard, which breaks session recognition across subdomains.
    supabaseResponse.cookies.getAll().forEach(cookie => {
      response.cookies.set({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        maxAge: cookie.maxAge,
        expires: cookie.expires,
      })
    })

    return response
  } catch (err) {
    console.error('Password sign-in failed:', err)
    return NextResponse.json({ ok: false, message: 'Something went wrong. Please try again.' })
  }
}
