import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { signedPhotoUrlAdmin } from '@/lib/photo-url'

export const dynamic = 'force-dynamic'

const BUCKET = 'memory-photos'
const ALERT_TO = 'garfieldbrittany@gmail.com'
const FROM = 'Rooted Health Check <hello@rootedhomeschoolapp.com>'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checkedAt = new Date().toISOString()

  // A dedicated synthetic object keeps the check independent of customer data
  // and deleted test accounts. Its path is configured per environment.
  const fixturePath = process.env.ROOTED_HEALTH_PHOTO_PATH?.trim()
  if (!fixturePath) {
    console.error('[health-check] ROOTED_HEALTH_PHOTO_PATH is not configured')
    return NextResponse.json(
      { ok: false, status: 0, checked_at: checkedAt, reason: 'missing_fixture' },
      { status: 503 },
    )
  }

  // The bucket is private, so sign afresh rather than HEAD an old saved URL.
  const url = await signedPhotoUrlAdmin(BUCKET, fixturePath, 60)
  if (!url) {
    return NextResponse.json(
      { ok: false, status: 0, checked_at: checkedAt, reason: 'sign_failed' },
      { status: 503 },
    )
  }
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
        text: `Daily health check failed. The synthetic photo returned status ${status}. Check the memory-photos storage bucket and any recent Supabase changes.`,
      })
    } catch (e) {
      console.error('[health-check] Resend send failed:', e)
    }
  }

  return NextResponse.json(
    { ok: status === 200, status, checked_at: checkedAt },
    { status: status === 200 ? 200 : 503 },
  )
}
