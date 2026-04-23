import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { runStripeLinkageAudit } from '@/lib/audit-stripe-linkage'

// Monthly Stripe ↔ profile linkage audit. Guarded by CRON_SECRET (same
// pattern as every other /api/cron/* route). Always returns 200 with a JSON
// report so the caller (Vercel cron or the scheduled remote agent) can
// parse `issueCount` to decide whether to page a human.
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  })

  try {
    const report = await runStripeLinkageAudit(stripe, supabase)
    console.log('[cron:audit-stripe-linkage]', {
      stripeActiveCount: report.stripeActiveCount,
      paidProfilesCount: report.paidProfilesCount,
      issueCount: report.issueCount,
    })
    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron:audit-stripe-linkage] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
