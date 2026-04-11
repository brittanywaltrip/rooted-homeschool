import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()

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
            })
          },
        },
      }
    )

    try {
      await supabase.auth.exchangeCodeForSession(code)

      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // Create a minimal profile row so onboarding can update it
          await supabase.from('profiles').upsert({ id: user.id }, { onConflict: 'id' })
          return NextResponse.redirect(new URL('/onboarding', requestUrl.origin))
        }

        return NextResponse.redirect(new URL('/dashboard', requestUrl.origin))
      }
    } catch (error) {
      console.error('Auth callback error:', error)
    }
  }

  return NextResponse.redirect(new URL('/login', requestUrl.origin))
}
