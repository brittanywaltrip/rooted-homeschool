import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.toUpperCase()
  if (!code) return NextResponse.json({ ok: true })

  try {
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id, clicks')
      .eq('code', code)
      .maybeSingle()

    if (affiliate) {
      await supabase
        .from('affiliates')
        .update({ clicks: (affiliate.clicks ?? 0) + 1 })
        .eq('id', affiliate.id)
    }
  } catch {
    // Silent fail
  }

  return NextResponse.json({ ok: true })
}
