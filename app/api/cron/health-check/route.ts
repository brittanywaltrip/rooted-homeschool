import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TEST_USER_ID = 'f30ede7e-ad40-42a9-a134-8fd70932ba0f'
const ALERT_TO = 'garfieldbrittany@gmail.com'
const FROM = 'Rooted Health Check <hello@rootedhomeschoolapp.com>'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checkedAt = new Date().toISOString()

  const { data: mem, error } = await supabase
    .from('memories')
    .select('photo_url')
    .eq('user_id', TEST_USER_ID)
    .eq('type', 'photo')
    .not('photo_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !mem?.photo_url) {
    return NextResponse.json({ ok: false, status: 0, checked_at: checkedAt, reason: 'no_photo' })
  }

  const url = mem.photo_url as string
  let status = 0
  try {
    const res = await fetch(url, { method: 'HEAD' })
    status = res.status
  } catch (e) {
    console.error('[health-check] HEAD request threw:', e)
    status = 0
  }

  if (status !== 200) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    try {
      await resend.emails.send({
        from: FROM,
        to: ALERT_TO,
        subject: '🔴 Rooted Health Check Failed',
        text: `Daily health check failed. Photo URL returned status ${status}. Check the memory-photos storage bucket and any recent Supabase changes. URL tested: ${url}`,
      })
    } catch (e) {
      console.error('[health-check] Resend send failed:', e)
    }
  }

  return NextResponse.json({ ok: status === 200, status, checked_at: checkedAt })
}
