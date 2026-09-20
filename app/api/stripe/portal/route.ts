import { NextResponse } from 'next/server'
import { stripeClient } from '@/lib/api-clients'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'


export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only route. Session refresh writes are not needed here.
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'no_customer' }, { status: 400 })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rootedhomeschoolapp.com'

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard/settings`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('stripe.billingPortal.sessions.create failed:', message)
    return NextResponse.json(
      { error: 'stripe_error', message },
      { status: 500 },
    )
  }
}
