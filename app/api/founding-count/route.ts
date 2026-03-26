import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const { data: countData, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('plan_type', 'founding_family')
    .eq('subscription_status', 'active')

  if (error || !countData) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }

  return NextResponse.json({ count: countData.length })
}
