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
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // Create a minimal profile row so onboarding can update it
          await supabaseAdmin.from('profiles').upsert({ id: user.id }, { onConflict: 'id' })
        }

        const redirectPath = !profile ? '/onboarding' : '/dashboard'
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
