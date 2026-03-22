import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const { count, error } = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('plan_type', 'founding_family')
    .eq('subscription_status', 'active')

  if (error || count === null) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }

  return NextResponse.json({ count })
}
