import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.rootedhomeschoolapp.com'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const errorParam = requestUrl.searchParams.get('error_description')

  // OAuth provider returned an error (e.g. user denied consent)
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorParam)}`, BASE_URL)
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
      cookieOptions: {
        domain: '.rootedhomeschoolapp.com',
      },
    }
  )

  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      console.error('Code exchange failed:', exchangeError.message)
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(exchangeError.message)}`, BASE_URL)
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
