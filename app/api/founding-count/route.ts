import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
