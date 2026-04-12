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
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code)
      console.log('Auth callback: session exchange error:', sessionError)

      const { data: { user }, error: userError } = await supabase.auth.getUser()
      console.log('Auth callback: user:', user?.id, 'email:', user?.email, 'error:', userError)

      if (user) {
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()
        console.log('Auth callback: profile check:', profile, 'error:', profileError)

        if (!profile) {
          // Create a minimal profile row so onboarding can update it
          const { error: upsertError } = await supabaseAdmin.from('profiles').upsert({ id: user.id }, { onConflict: 'id' })
          console.log('Auth callback: upsert error:', upsertError)
        }

        const redirectPath = !profile ? '/onboarding' : '/dashboard'
        console.log('Auth callback: redirecting to', redirectPath)
        const redirectResponse = NextResponse.redirect(new URL(redirectPath, requestUrl.origin))

        supabaseResponse.cookies.getAll().forEach(cookie => {
          redirectResponse.cookies.set(cookie.name, cookie.value)
        })

        return redirectResponse
      } else {
        console.log('Auth callback: no user after session exchange')
      }
    } catch (error) {
      console.error('Auth callback CATCH:', error)
    }
  }

  return NextResponse.redirect(new URL('/login', requestUrl.origin))
}
