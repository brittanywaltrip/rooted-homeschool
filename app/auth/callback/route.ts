import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
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
      }
    )

    try {
      await supabase.auth.exchangeCodeForSession(code)

      // Password recovery flow — redirect to set-new-password page
      const type = requestUrl.searchParams.get('type')
      if (type === 'recovery') {
        const redirectResponse = NextResponse.redirect(new URL('/reset-password', requestUrl.origin))
        supabaseResponse.cookies.getAll().forEach(cookie => {
          redirectResponse.cookies.set(cookie.name, cookie.value)
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
          await supabaseAdmin.from('profiles').upsert({ id: user.id }, { onConflict: 'id' })
        }

        const redirectPath = !profile || profile.onboarded !== true ? '/onboarding' : '/dashboard'
        const redirectResponse = NextResponse.redirect(new URL(redirectPath, requestUrl.origin))

        supabaseResponse.cookies.getAll().forEach(cookie => {
          redirectResponse.cookies.set(cookie.name, cookie.value)
        })

        return redirectResponse
      }
    } catch (error) {
      console.error('Auth callback error:', error)
    }
  }

  return NextResponse.redirect(new URL('/login', requestUrl.origin))
}
