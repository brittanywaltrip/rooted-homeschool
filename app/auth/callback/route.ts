import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCookieDomain } from '@/lib/cookie-domain'

// Map raw Supabase auth errors into stable short codes that the
// /login page knows how to render as friendly recovery copy.
// Keeping this in the callback means /login never sees raw provider
// strings and we have one place to add new mappings.
function mapAuthErrorToCode(message: string | undefined | null): string {
  const msg = (message || '').toLowerCase()
  if (msg.includes('code verifier')) return 'pkce_cross_device'
  if (msg.includes('expired')) return 'link_expired'
  if (msg.includes('invalid') && msg.includes('grant')) return 'link_used'
  if (msg.includes('already')) return 'link_used'
  return 'callback_failed'
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const BASE_URL = `${requestUrl.protocol}//${requestUrl.host}`
  const runtimeDomain = getCookieDomain(requestUrl.hostname)
  const code = requestUrl.searchParams.get('code')
  const errorParam = requestUrl.searchParams.get('error_description')

  // OAuth provider returned an error (e.g. user denied consent)
  if (errorParam) {
    // Provider denial or upstream OAuth error. We don't surface the raw
    // provider text because it's often technical ("access_denied", etc.).
    return NextResponse.redirect(
      new URL('/login?error=provider_denied', BASE_URL)
    )
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', BASE_URL))
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
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      // Keep the raw message in server logs for debugging, but translate
      // to a stable code for the user-facing URL so we never render raw
      // Supabase strings.
      console.error('Code exchange failed:', exchangeError.message)
      const code = mapAuthErrorToCode(exchangeError.message)
      return NextResponse.redirect(
        new URL(`/login?error=${code}`, BASE_URL)
      )
    }

    // Password recovery flow — check both type=recovery and next=/reset-password
    const type = requestUrl.searchParams.get('type')
    const next = requestUrl.searchParams.get('next')
    if (type === 'recovery' || next === '/reset-password') {
      const redirectResponse = NextResponse.redirect(new URL('/reset-password', BASE_URL))
      // IMPORTANT: preserve full cookie options (especially `domain`) when
      // copying from supabaseResponse to the redirect. Dropping the domain
      // option scopes cookies to the response host instead of the apex
      // wildcard, which breaks session recognition and causes OAuth loops.
      supabaseResponse.cookies.getAll().forEach(cookie => {
        redirectResponse.cookies.set({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite as any,
          maxAge: cookie.maxAge,
          expires: cookie.expires,
        })
      })
      return redirectResponse
    }

    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, onboarded')
        .eq('id', user.id)
        .single()

      if (!profile) {
        // New user — create profile and populate Google metadata if available
        const meta = user.user_metadata ?? {}
        const firstName = meta.given_name || meta.first_name || (meta.full_name?.split(' ')[0]) || null
        const lastName = meta.family_name || meta.last_name || (meta.full_name?.split(' ').slice(1).join(' ')) || null

        await supabaseAdmin.from('profiles').upsert({
          id: user.id,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        }, { onConflict: 'id' })
      }

      const redirectPath = !profile || profile.onboarded !== true ? '/onboarding' : '/dashboard'
      const redirectResponse = NextResponse.redirect(new URL(redirectPath, BASE_URL))

      // IMPORTANT: preserve full cookie options (especially `domain`) when
      // copying from supabaseResponse to the redirect. Dropping the domain
      // option scopes cookies to the response host instead of the apex
      // wildcard, which breaks session recognition and causes OAuth loops.
      supabaseResponse.cookies.getAll().forEach(cookie => {
        redirectResponse.cookies.set({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite as any,
          maxAge: cookie.maxAge,
          expires: cookie.expires,
        })
      })

      return redirectResponse
    }
  } catch (error) {
    console.error('Auth callback error:', error)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', BASE_URL))
}
